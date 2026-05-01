import {exec} from "node:child_process";
import {promisify} from "node:util";
import {appLogger} from "../logging/logger";
import type {ErrorLike} from "../common/boundary-types";

const execAsync = promisify(exec);
const logger = appLogger.child("shell-command-runner");

type ShellCommandFailure = {
    code?: string | number;
    stdout?: string;
    stderr?: string;
    message?: string;
};

export type ShellCommandResult = {
    stdout: string | null | undefined;
    stderr: string | null | undefined;
};

export class ShellCommandRunner {
    private static readonly forbiddenPatterns = [
        /\bsudo\b/,
        /\bsu\b/,
        /\brm\b/,
        /\brmdir\b/,
        /\bchmod\b/,
        /\bchown\b/,
        /\bdd\b/,
        /\bmkfs\b/,
        /\bmount\b/,
        /\bumount\b/,
        /\breboot\b/,
        /\bshutdown\b/,
        /\bkill\b/,
        /\bdel\b/i,
        /\berase\b/i,
        /\brd\b/i,
        /\bformat\b/i,
        /\btaskkill\b/i,
        /\bRemove-Item\b/i,
        /\bMove-Item\b/i,
        /\bStop-Process\b/i,
        /\bRestart-Computer\b/i,
        /\bStop-Computer\b/i,
        /\bcurl\b/,
        /\bwget\b/,
        /\bInvoke-WebRequest\b/i,
        /\bInvoke-RestMethod\b/i,
        /\bssh\b/,
        /\bscp\b/,
        /\brsync\b/,
        /\bnc\b/,
        /\bnmap\b/,
        /\.\./,
        /\/etc\/?/,
        /\/home\/?/,
        /\/root\/?/,
        /~\//,
        /\.ssh/,
        /\.env/,
    ];

    static async run(command: string): Promise<ShellCommandResult> {
        ShellCommandRunner.assertSafe(command);

        try {
            const {stdout, stderr} = await execAsync(command, {
                timeout: 15_000,
                maxBuffer: 64 * 1024,
            });
            if (stdout) {
                logger.debug("command.stdout", {command, stdout});
            }

            if (stderr) {
                logger.warn("command.stderr", {command, stderr});
            }

            return {stdout, stderr};
        } catch (error) {
            const err = ShellCommandRunner.normalizeFailure(error instanceof Error ? error : String(error));
            logger.error("command.failed", {command, code: err.code, stderr: err.stderr, error: err.message});

            return {stdout: err.stdout ?? null, stderr: err.stderr ?? err.message};
        }
    }

    private static normalizeFailure(error: ErrorLike | object | number | boolean | null | undefined): ShellCommandFailure {
        if (typeof error === "string") {
            return {message: error};
        }

        if (error instanceof Error) {
            const failure: ShellCommandFailure = {
                message: error.message,
            };

            if ("code" in error && (typeof error.code === "string" || typeof error.code === "number")) {
                failure.code = error.code;
            }

            return failure;
        }

        if (typeof error === "object" && error !== null) {
            const failure = error as ShellCommandFailure;
            return {
                code: failure.code,
                stdout: failure.stdout,
                stderr: failure.stderr,
                message: failure.message,
            };
        }

        return {
            message: String(error),
        };
    }

    private static assertSafe(command: string): void {
        if (command.length > 500) {
            throw new Error("Command is too long");
        }

        for (const pattern of ShellCommandRunner.forbiddenPatterns) {
            if (pattern.test(command)) {
                throw new Error(`Forbidden shell command pattern: ${pattern}`);
            }
        }
    }
}
