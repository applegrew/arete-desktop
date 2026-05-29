import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Minimal Anthropic Agent Skills (SKILL.md) loader. A skill is a directory under
 * `skills/` containing a `SKILL.md` with YAML frontmatter (`name`, `description`)
 * and a Markdown body of instructions. v1 loads the instruction bundles into the
 * system prompt; sandboxed script execution is future scope.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', 'skills');

export interface Skill {
  name: string;
  description: string;
  body: string;
}

export function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    skills.push(parseSkill(readFileSync(file, 'utf8'), entry.name));
  }
  return skills;
}

function parseSkill(raw: string, fallbackName: string): Skill {
  let name = fallbackName;
  let description = '';
  let body = raw.trim();
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    const front = fm[1] ?? '';
    body = (fm[2] ?? '').trim();
    const nameMatch = front.match(/^name:\s*(.+)$/m);
    const descMatch = front.match(/^description:\s*(.+)$/m);
    if (nameMatch?.[1]) name = nameMatch[1].trim();
    if (descMatch?.[1]) description = descMatch[1].trim();
  }
  return { name, description, body };
}

/** Render loaded skills as a system-prompt section. Empty string when none. */
export function renderSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map(
    (s) => `### Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.body}`,
  );
  return `\n\nSKILLS — procedural instructions you have been given. When the user's request matches a skill, follow its steps exactly:\n\n${blocks.join('\n\n')}\n`;
}
