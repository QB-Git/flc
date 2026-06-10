use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Url;

const CLIENT_MODULE_LOADER: &str = include_str!("client_module_loader.js");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientModule {
    id: String,
    manifest_id: String,
    title: String,
    root_path: String,
    scripts: Vec<String>,
    esmodules: Vec<String>,
    styles: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct FoundryModuleManifest {
    id: Option<String>,
    name: Option<String>,
    title: Option<String>,
    version: Option<String>,
    scripts: Option<Vec<String>>,
    esmodules: Option<Vec<String>>,
    styles: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFoundryModule {
    id: String,
    title: String,
    version: Option<String>,
    root_path: String,
    scripts: Vec<String>,
    esmodules: Vec<String>,
    styles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InjectedModule {
    id: String,
    title: String,
    manifest_id: String,
    scripts: Vec<InjectedAsset>,
    esmodule_entries: Vec<String>,
    esmodules: Vec<InjectedAsset>,
    styles: Vec<InjectedAsset>,
    templates: Vec<InjectedTemplate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InjectedAsset {
    id: String,
    path: String,
    source: String,
    source_url: String,
    imports: Vec<InjectedImport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InjectedImport {
    specifier: String,
    target_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InjectedTemplate {
    path: String,
    source: String,
}

#[tauri::command]
pub async fn import_foundry_module(path: String) -> Result<ImportedFoundryModule, String> {
    let root = PathBuf::from(path);
    let manifest_path = root.join("module.json");
    let manifest_source = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read module.json: {}", e))?;
    let manifest: FoundryModuleManifest = serde_json::from_str(&manifest_source)
        .map_err(|e| format!("Invalid module.json: {}", e))?;

    let id = manifest
        .id
        .or(manifest.name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "module.json must define an id or name".to_string())?;
    let title = manifest
        .title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.clone());
    let root_path = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve module directory: {}", e))?;

    Ok(ImportedFoundryModule {
        id,
        title,
        version: manifest.version,
        root_path: root_path.to_string_lossy().to_string(),
        scripts: sanitize_manifest_paths(manifest.scripts, "scripts")?,
        esmodules: sanitize_manifest_paths(manifest.esmodules, "esmodules")?,
        styles: sanitize_manifest_paths(manifest.styles, "styles")?,
    })
}

pub fn build_initialization_script(
    parsed_url: &Url,
    modules: &[ClientModule],
) -> Result<String, String> {
    let expected_origin = serde_json::to_string(&parsed_url.origin().ascii_serialization())
        .map_err(|e| format!("Failed to serialize server origin: {}", e))?;
    let injected_modules = modules
        .iter()
        .map(read_injected_module)
        .collect::<Result<Vec<_>, String>>()?;
    let modules_json = serde_json::to_string(&injected_modules)
        .map_err(|e| format!("Failed to serialize modules: {}", e))?;

    Ok(CLIENT_MODULE_LOADER
        .replace("__FLC_EXPECTED_ORIGIN__", &expected_origin)
        .replace("__FLC_MODULES__", &modules_json))
}

fn read_injected_module(module: &ClientModule) -> Result<InjectedModule, String> {
    let root_path = PathBuf::from(&module.root_path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {}: {}", module.root_path, e))?;
    let (esmodule_entries, esmodules) =
        read_esmodule_assets(&root_path, &module.id, &module.esmodules)?;

    Ok(InjectedModule {
        id: module.id.clone(),
        title: module.title.clone(),
        manifest_id: module.manifest_id.clone(),
        styles: read_injected_assets(&root_path, &module.id, &module.styles, "styles")?,
        scripts: read_injected_assets(&root_path, &module.id, &module.scripts, "scripts")?,
        esmodule_entries,
        esmodules,
        templates: read_template_assets(&root_path, &module.manifest_id)?,
    })
}

fn read_injected_assets(
    root_path: &Path,
    module_id: &str,
    paths: &[String],
    field: &str,
) -> Result<Vec<InjectedAsset>, String> {
    paths
        .iter()
        .map(|relative_path| {
            let path = resolve_module_file(root_path, relative_path, field)?;
            let source = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {}", relative_path, e))?;

            Ok(InjectedAsset {
                id: format!("{}:{}", module_id, relative_path),
                path: relative_path.clone(),
                source,
                source_url: module_source_url(module_id, relative_path),
                imports: Vec::new(),
            })
        })
        .collect()
}

fn read_esmodule_assets(
    root_path: &Path,
    module_id: &str,
    entries: &[String],
) -> Result<(Vec<String>, Vec<InjectedAsset>), String> {
    let mut assets = HashMap::new();
    let mut entry_ids = Vec::new();

    for entry in entries {
        let entry_path = normalize_module_path(entry)?;
        let entry_id = format!("{}:{}", module_id, entry_path);
        collect_esmodule_asset(root_path, module_id, &entry_path, &mut assets)?;
        entry_ids.push(entry_id);
    }

    let mut assets = assets.into_values().collect::<Vec<InjectedAsset>>();
    assets.sort_by(|a, b| a.path.cmp(&b.path));

    Ok((entry_ids, assets))
}

fn collect_esmodule_asset(
    root_path: &Path,
    module_id: &str,
    relative_path: &str,
    assets: &mut HashMap<String, InjectedAsset>,
) -> Result<(), String> {
    let normalized_path = normalize_module_path(relative_path)?;
    let id = format!("{}:{}", module_id, normalized_path);

    if assets.contains_key(&id) {
        return Ok(());
    }

    let path = resolve_module_file(root_path, &normalized_path, "esmodules")?;
    let source = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", normalized_path, e))?;
    let imports = extract_local_import_specifiers(&source)
        .into_iter()
        .map(|specifier| {
            let target_path = resolve_import_path(root_path, &normalized_path, &specifier)?;
            let target_id = format!("{}:{}", module_id, target_path);

            Ok(InjectedImport {
                specifier,
                target_id,
            })
        })
        .collect::<Result<Vec<InjectedImport>, String>>()?;

    let dependency_paths = imports
        .iter()
        .map(|module_import| module_import.target_id.clone())
        .collect::<Vec<String>>();

    assets.insert(
        id.clone(),
        InjectedAsset {
            id,
            path: normalized_path.clone(),
            source,
            source_url: module_source_url(module_id, &normalized_path),
            imports,
        },
    );

    for dependency_id in dependency_paths {
        if let Some(dependency_path) = dependency_id.strip_prefix(&format!("{}:", module_id)) {
            collect_esmodule_asset(root_path, module_id, dependency_path, assets)?;
        }
    }

    Ok(())
}

fn extract_local_import_specifiers(source: &str) -> Vec<String> {
    let mut specifiers = Vec::new();
    let bytes = source.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let quote = bytes[index];

        if quote != b'"' && quote != b'\'' {
            index += 1;
            continue;
        }

        let start = index + 1;
        let mut end = start;
        let mut escaped = false;

        while end < bytes.len() {
            let byte = bytes[end];

            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == quote {
                break;
            }

            end += 1;
        }

        if end >= bytes.len() {
            break;
        }

        if let Ok(specifier) = std::str::from_utf8(&bytes[start..end]) {
            if is_local_import_specifier(specifier)
                && is_probable_import_context(&source[..index])
                && !specifiers.iter().any(|existing| existing == specifier)
            {
                specifiers.push(specifier.to_string());
            }
        }

        index = end + 1;
    }

    specifiers
}

fn is_local_import_specifier(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../")
}

fn is_probable_import_context(prefix: &str) -> bool {
    let context = prefix
        .rsplit(['\n', ';', '{', '}'])
        .next()
        .unwrap_or("")
        .trim();

    context.ends_with("from")
        || context.ends_with("import")
        || context.ends_with("import(")
        || context.ends_with("export")
        || context.contains(" import ")
        || context.contains(" export ")
}

fn resolve_import_path(
    root_path: &Path,
    from_path: &str,
    specifier: &str,
) -> Result<String, String> {
    let from_parent = Path::new(from_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let requested = normalize_module_path(
        &from_parent
            .join(specifier)
            .to_string_lossy()
            .replace('\\', "/"),
    )?;

    for candidate in import_path_candidates(&requested) {
        if resolve_module_file(root_path, &candidate, "esmodule import").is_ok() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Failed to resolve local ES module import {} from {}",
        specifier, from_path
    ))
}

fn import_path_candidates(path: &str) -> Vec<String> {
    let mut candidates = vec![path.to_string()];

    if Path::new(path).extension().is_none() {
        candidates.push(format!("{}.js", path));
        candidates.push(format!("{}.mjs", path));
        candidates.push(format!("{}/index.js", path));
        candidates.push(format!("{}/index.mjs", path));
    }

    candidates
}

fn normalize_module_path(path: &str) -> Result<String, String> {
    let mut parts = Vec::new();

    for component in Path::new(path).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::ParentDir => {
                if parts.pop().is_none() {
                    return Err(format!("module path contains an unsafe path: {}", path));
                }
            }
            _ => return Err(format!("module path contains an unsafe path: {}", path)),
        }
    }

    Ok(parts.join("/"))
}

fn resolve_module_file(
    root_path: &Path,
    relative_path: &str,
    field: &str,
) -> Result<PathBuf, String> {
    ensure_safe_relative_path(relative_path, field)?;

    let path = root_path.join(relative_path);
    let canonical_path = path
        .canonicalize()
        .map_err(|_| format!("Module file not found: {}", relative_path))?;

    if !canonical_path.starts_with(root_path) {
        return Err(format!(
            "{} escapes module directory: {}",
            field, relative_path
        ));
    }

    Ok(canonical_path)
}

fn read_template_assets(
    root_path: &Path,
    manifest_id: &str,
) -> Result<Vec<InjectedTemplate>, String> {
    let mut templates = Vec::new();
    collect_template_assets(root_path, root_path, manifest_id, &mut templates)?;
    templates.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(templates)
}

fn collect_template_assets(
    root_path: &Path,
    current_path: &Path,
    manifest_id: &str,
    templates: &mut Vec<InjectedTemplate>,
) -> Result<(), String> {
    let entries = fs::read_dir(current_path).map_err(|e| {
        format!(
            "Failed to read template directory {:?}: {}",
            current_path, e
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read template entry: {}", e))?;
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if file_name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            collect_template_assets(root_path, &path, manifest_id, templates)?;
            continue;
        }

        if path.extension().and_then(|extension| extension.to_str()) != Some("hbs") {
            continue;
        }

        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve template {:?}: {}", path, e))?;

        if !canonical_path.starts_with(root_path) {
            continue;
        }

        let relative_path = canonical_path
            .strip_prefix(root_path)
            .map_err(|e| format!("Failed to compute template path: {}", e))?
            .to_string_lossy()
            .replace('\\', "/");
        let source = fs::read_to_string(&canonical_path)
            .map_err(|e| format!("Failed to read template {}: {}", relative_path, e))?;

        templates.push(InjectedTemplate {
            path: format!("modules/{}/{}", manifest_id, relative_path),
            source,
        });
    }

    Ok(())
}

fn sanitize_manifest_paths(paths: Option<Vec<String>>, field: &str) -> Result<Vec<String>, String> {
    paths
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.trim().replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .map(|path| {
            ensure_safe_relative_path(&path, field)?;
            Ok(path)
        })
        .collect()
}

fn ensure_safe_relative_path(path: &str, field: &str) -> Result<(), String> {
    let parsed = Path::new(path);

    if parsed.is_absolute()
        || parsed.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("{} contains an unsafe path: {}", field, path));
    }

    Ok(())
}

fn module_source_url(module_id: &str, relative_path: &str) -> String {
    format!("flc-module:///{}/{}", module_id, relative_path)
}
