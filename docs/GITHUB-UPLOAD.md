# Uploading to GitHub

The project already has a Git repository. Run these commands from the project root; do not run `git init` again.

## Review and commit

```powershell
git status --short
git add -A
git diff --cached --stat
git diff --cached --name-only
git commit -m "Prepare Collection Monitoring with MySQL and collector history"
```

Review the staged file list before committing. It should include the source, schema, documentation, package lock, and `.env.example`. It must not include `.env`, `.env.local`, dependencies, build output, logs, database exports, or actual member/payment data. Deleted files from the old deployment setup should appear as deletions.

## Connect the repository

Create an empty repository on GitHub. Choose Private if the source is intended only for your team or client. Leave GitHub's README, license, and gitignore initialization options unchecked because the project already contains files and history.

Check the current branch and remotes:

```powershell
git branch --show-current
git remote -v
```

If there is no `origin`, add your new repository URL:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
```

If `origin` already exists, confirm it is the intended destination. Only change it if needed:

```powershell
git remote set-url origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
```

Push the current branch without renaming it or force-pushing:

```powershell
git push -u origin HEAD
```

Use GitHub's sign-in prompt or your configured Git credentials. Never place a password or access token in the repository URL or project files.

## After uploading

Check the repository's Actions tab for the build and test result. A new collaborator can follow the README to install dependencies, configure their own `.env.local`, create the MySQL schema, and start the app.

Git uploads committed history as well as current files. Ignore rules do not remove files from older commits. The preparation checks are a basic screening, not a full historical secret audit.
