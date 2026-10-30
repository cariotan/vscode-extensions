# Custom Quick Open

A VS Code extension (`custom-quick-open`) for fast file and symbol search with customizable high/low priority path sorting and exclusion patterns.

---

## Packaging & Installing (`npm run package`)

Packaging is configured in `package.json` to run quickly (`--no-dependencies`) and non-interactively (`--allow-missing-repository --skip-license`), while automatically managing the version number in `package.json`.

### 1. Auto-Increment Patch Version (Default)
If you run `npm run package` without any arguments, it automatically increments the **patch** version by `1` in `package.json` (e.g., `0.0.19` -> `0.0.20`) and generates the `.vsix` file:
```powershell
npm run package
```

### 2. Set a Specific Version
Pass an explicit version number to set `package.json` to that version and package it:
```powershell
npm run package 0.0.25
# or with a leading "v":
npm run package v1.2.0
```

### 3. Increment `minor` or `major` Version
You can also pass `patch`, `minor`, or `major` to bump the corresponding semantic version segment:
```powershell
# 0.0.19 -> 0.0.20
npm run package patch

# 0.0.19 -> 0.1.0
npm run package minor

# 0.0.19 -> 1.0.0
npm run package major
```

---

## Package & Install Locally in One Command (`npm run install-local`)

To package the `.vsix` **and** immediately install it into VS Code (`code --install-extension`), use `install-local`. It supports all the same version arguments as `npm run package`:

```powershell
# Auto-increment patch version, package, and install into VS Code:
npm run install-local

# Set a specific version, package, and install into VS Code:
npm run install-local 0.0.25

# Bump minor/major version, package, and install into VS Code:
npm run install-local minor
npm run install-local major
```
