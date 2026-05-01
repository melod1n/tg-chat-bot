import {AiTool} from "../tool-types";
import {runCommand} from "../../util/utils";
import {asNonEmptyString} from "./utils";
import {AiJsonObject} from "../tool-types";

export const shellExecuteTool = {
    type: "function",
    function: {
        name: "shell_execute",
        description: "Execute NON-Python command in a shell. Do not use if you intend to execute some python.",
        parameters: {
            type: "object",
            properties: {
                cmd: {
                    type: "string",
                    description: "Actual command to execute in a shell"
                }
            },
            required: ["cmd"]
        }
    }
} satisfies AiTool;

export const shellExecuteToolPrompt = [
    "Shell tool rules:",
    "- You have access to the `shell_execute` tool.",
    "- `shell_execute` executes a shell command on the server.",
    "- This tool is powerful and potentially dangerous.",
    "- Use this tool only when command execution is actually necessary.",
    "- Prefer specialized tools when available, for example filesystem tools for reading, creating, updating, copying, moving or deleting files.",
    "",
    "Platform awareness:",
    "- The server shell may be Linux/macOS shell, Windows CMD, or Windows PowerShell.",
    "- Do not assume Bash/Linux commands are available.",
    "- Do not assume Windows commands are available.",
    "- If the current OS/shell is unclear, first run a safe environment inspection command.",
    "- Safe OS inspection examples:",
    "  - Node.js: `node -p \"process.platform\"`",
    "  - Node.js: `node -p \"process.cwd()\"`",
    "  - Windows CMD: `ver`",
    "  - PowerShell: `$PSVersionTable.PSVersion`",
    "  - POSIX shell: `uname -a`",
    "",
    "Preferred safe commands:",
    "- Prefer read-only commands.",
    "- Prefer short, explicit and predictable commands.",
    "- Cross-platform when Node.js is available:",
    "  - `node -p \"process.cwd()\"`",
    "  - `node -p \"process.platform\"`",
    "  - `node -e \"console.log(require('fs').readdirSync('.'))\"`",
    "- POSIX examples:",
    "  - `pwd`, `ls`, `find`, `cat`, `head`, `tail`, `grep`, `sed -n`, `wc`, `stat`, `file`, `du`, `df`, `ps`.",
    "- Windows CMD examples:",
    "  - `cd`, `dir`, `type`, `where`, `findstr`.",
    "- PowerShell examples:",
    "  - `Get-Location`, `Get-ChildItem`, `Get-Content`, `Select-String`, `Measure-Object`, `Get-Item`, `Get-Process`.",
    "",
    "Filesystem restrictions:",
    "- Work only inside the allowed project/root directory.",
    "- Use relative paths when possible.",
    "- Do not use absolute paths unless the user explicitly asks and it is safe.",
    "- Do not use `..` to go to parent directories.",
    "- Do not access files outside the allowed root directory.",
    "- Do not follow or use symlinks to escape the allowed root directory.",
    "",
    "Forbidden actions unless the user explicitly asks and the action is clearly safe:",
    "- Do not delete files or directories.",
    "- Do not overwrite files.",
    "- Do not move files.",
    "- Do not change permissions.",
    "- Do not change ownership.",
    "- Do not install packages.",
    "- Do not update the system.",
    "- Do not start, stop or restart services.",
    "- Do not run background processes.",
    "- Do not run long-running commands.",
    "- Do not run infinite loops.",
    "- Do not use fork bombs.",
    "- Do not use privilege escalation.",
    "",
    "Forbidden command examples:",
    "- POSIX: `sudo`, `su`, `rm`, `rmdir`, `chmod`, `chown`, `dd`, `mkfs`, `mount`, `umount`, `kill`, `reboot`, `shutdown`.",
    "- Windows CMD: `del`, `erase`, `rmdir`, `rd`, `format`, `shutdown`, `taskkill`.",
    "- PowerShell: `Remove-Item`, `Move-Item`, `Set-ItemProperty`, `Stop-Process`, `Restart-Computer`, `Stop-Computer`.",
    "",
    "Network restrictions:",
    "- Do not make network requests unless the user explicitly asks.",
    "- Do not use `curl`, `wget`, `Invoke-WebRequest`, `Invoke-RestMethod`, `ssh`, `scp`, `rsync`, `nc`, `nmap` unless explicitly requested and safe.",
    "",
    "Secrets and privacy:",
    "- Never read secrets, tokens, API keys, passwords, private keys, certificates, `.env` files, SSH keys, browser data or credential stores unless the user explicitly asks and it is necessary.",
    "- If command output contains secrets, do not repeat them back to the user.",
    "",
    "Command construction:",
    "- Do not execute untrusted user text directly as shell code.",
    "- Quote paths and arguments safely.",
    "- Avoid command chaining with `;`, `&&`, `||`, pipes, backticks or command substitution unless necessary.",
    "- Avoid glob patterns that may affect too many files.",
    "- If unsure whether a command is safe, do not run it.",
    "",
].join("\n");

export async function shellExecute(args?: AiJsonObject): Promise<string | undefined | null> {
    const cmd = asNonEmptyString(args?.cmd);
    if (!cmd) return undefined;

    const {stdout, stderr} = await runCommand(cmd);

    return stdout ?? stderr;
}
