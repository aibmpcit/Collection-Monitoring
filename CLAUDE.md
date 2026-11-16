# Collection Monitoring

Project notes live in the shared Obsidian vault `C:\Users\ASUS\Desktop\system_development`
(add it with `/add-dir C:\Users\ASUS\Desktop\system_development` if it is not already available):

- `Projects/collection-monitoring/Overview.md` — purpose, stack, code location, commands, architecture
- `Projects/collection-monitoring/Progress.md` — current state, known issues, next tasks
- `Projects/collection-monitoring/Decisions.md` — important decisions and their reasons

Conventions shared by all projects: `Guides/Developer Notes System.md` in the vault.

- Read Overview and Progress before substantial work; check Decisions before changing an earlier choice.
- After a meaningful task, update Progress (current state, known issues, next tasks) and its `updated` property.
- Record significant decisions in Decisions (newest first, with date and reason).
- Keep notes concise. Never store secrets (keys, passwords, tokens, `.env` values) or unnecessary personal data.
- Change only `Projects/collection-monitoring/`; use path-qualified wikilinks such as `[[Projects/collection-monitoring/Progress|Progress]]`.
- Format notes with the vault's `obsidian-markdown` skill
  (`C:\Users\ASUS\Desktop\system_development\.claude\skills\obsidian-markdown\SKILL.md`); if the skill is not
  listed, read that file directly.
- Obsidian CLI (`obsidian`, Obsidian must be running): read with
  `obsidian vault=system_development read path=Projects/collection-monitoring/Progress.md`; check links with
  `obsidian vault=system_development unresolved`. Never use its delete, plugin, theme, sync, eval or dev commands.
