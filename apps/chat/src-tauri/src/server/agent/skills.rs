use std::path::Path;

/// A SKILL.md instruction bundle (port of `skills.ts`).
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}

/// Load every `<dir>/<sub>/SKILL.md`. Missing dir → empty (the default).
pub fn load_skills(dir: &Path) -> Vec<Skill> {
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file = path.join("SKILL.md");
        if !file.exists() {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&file) {
            let fallback = entry.file_name().to_string_lossy().to_string();
            out.push(parse_skill(&raw, &fallback));
        }
    }
    out
}

/// Parse `---`-fenced YAML frontmatter (`name`/`description`) + Markdown body.
fn parse_skill(raw: &str, fallback: &str) -> Skill {
    let mut name = fallback.to_string();
    let mut description = String::new();
    let mut body = raw.trim().to_string();

    if let Some(rest) = raw.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let front = &rest[..end];
            // Body starts after the closing "\n---" and an optional trailing newline.
            let after = &rest[end + 4..];
            let after = after.strip_prefix('\n').unwrap_or(after);
            body = after.trim().to_string();
            for line in front.lines() {
                if let Some(v) = line.strip_prefix("name:") {
                    name = v.trim().to_string();
                } else if let Some(v) = line.strip_prefix("description:") {
                    description = v.trim().to_string();
                }
            }
        }
    }
    Skill { name, description, body }
}

/// Render loaded skills as a system-prompt section. Empty string when none.
pub fn render_skills_for_prompt(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let blocks: Vec<String> = skills
        .iter()
        .map(|s| {
            let desc = if s.description.is_empty() {
                String::new()
            } else {
                format!("{}\n", s.description)
            };
            format!("### Skill: {}\n{}{}", s.name, desc, s.body)
        })
        .collect();
    format!(
        "\n\nSKILLS — procedural instructions you have been given. When the user's request matches a skill, follow its steps exactly:\n\n{}\n",
        blocks.join("\n\n")
    )
}
