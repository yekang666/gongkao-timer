@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VERSION=v2.29.3"
set "COMMIT_MESSAGE=v2.29.3: harden long-press pacing drag"

echo === Prepare %VERSION% for GitHub ===

where git >nul 2>nul || goto :missing_git
where node >nul 2>nul || goto :missing_node

git rev-parse --is-inside-work-tree >nul 2>nul || goto :not_repo
git fetch origin || goto :failed
git merge-base --is-ancestor origin/main HEAD || goto :remote_ahead

node scripts\bump-version.mjs "%VERSION%" || goto :failed
call npm run check || goto :failed
call npm run check:stats-browser || goto :failed

git add -u || goto :failed
git add -- .assetsignore .gitignore assets js scripts index.html manifest.webmanifest package.json pip-countdown.mp4 pip-stopwatch.mp4 push-to-github.bat README.md styles.css sw.js wrangler.jsonc || goto :failed
git diff --cached --check || goto :failed

git diff --cached --quiet
if not errorlevel 1 goto :check_unpushed

echo.
echo Changes ready to upload:
git status --short
echo.
choice /C YN /N /M "Commit and push %VERSION% to origin/main? [Y/N] "
if errorlevel 2 goto :cancelled

git commit -m "%COMMIT_MESSAGE%" || goto :failed
goto :push

:check_unpushed
for /f %%C in ('git rev-list --count origin/main..HEAD') do set "AHEAD=%%C"
if "%AHEAD%"=="0" goto :nothing_to_commit

echo.
echo No new file changes, but %AHEAD% local commit(s) still need to be pushed.
choice /C YN /N /M "Push them to origin/main? [Y/N] "
if errorlevel 2 goto :cancelled

:push
git push origin main || goto :failed

echo.
echo Uploaded %VERSION% successfully.
goto :done

:remote_ahead
echo.
echo origin/main contains commits that are not in this local branch.
echo Pull and resolve them before running this script again.
goto :failed

:nothing_to_commit
echo.
echo Nothing to commit. The working tree is already prepared.
goto :done

:cancelled
echo.
echo Cancelled. Changes remain staged locally.
goto :done

:missing_git
echo Git was not found in PATH.
goto :failed

:missing_node
echo Node.js was not found in PATH.
goto :failed

:not_repo
echo This script is not inside a Git repository.
goto :failed

:failed
echo.
echo Upload stopped because a command failed.
pause
exit /b 1

:done
pause
exit /b 0
