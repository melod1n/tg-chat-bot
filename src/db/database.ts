import * as fs from "fs";
import {Environment} from "../common/environment";
import {logError} from "../util/utils";
import {Answers} from "../model/answers";
import path from "node:path";
import {KeyedAsyncLock} from "../util/async-lock";

type DataJsonFile = {
    admins: number[]
    muted: number[]
}

export let jsonFile: DataJsonFile;

const DEFAULT_DATA: DataJsonFile = {
    admins: [],
    muted: [],
};

const DEFAULT_ANSWERS: Answers = {
    test: ["a"],
    prefix: ["?"],
    better: ["Better"],
    who: [],
    kick: [],
    invite: [],
    day: [],
};

const dataFileLock = new KeyedAsyncLock();

function ensureDataPath(): void {
    fs.mkdirSync(Environment.DATA_PATH, {recursive: true});
}

function readJsonFile<T>(fileName: string, defaultValue: T): T {
    ensureDataPath();

    const filePath = `${Environment.DATA_PATH}/${fileName}`;
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        return structuredClone(defaultValue);
    }

    return JSON.parse(fs.readFileSync(filePath).toString()) as T;
}

export async function readData(): Promise<void> {
    try {
        jsonFile = readJsonFile("data.json", DEFAULT_DATA);

        const admins = jsonFile.admins || [];
        admins.unshift(Environment.CREATOR_ID);

        Environment.setAdmins(new Set<number>(admins));
        Environment.setMuted(new Set<number>(jsonFile.muted || []));

        return Promise.resolve();
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return Promise.reject(e);
    }
}

export async function saveData(): Promise<void> {
    return dataFileLock.runExclusive("data.json", async () => {
        ensureDataPath();
        jsonFile ??= structuredClone(DEFAULT_DATA);

        const adminIds: number[] = [];
        Environment.ADMIN_IDS.forEach(id => adminIds.push(id));
        jsonFile.admins = adminIds;

        const mutedList: number[] = [];
        Environment.MUTED_IDS.forEach(id => mutedList.push(id));
        jsonFile.muted = mutedList;

        try {
            const filePath = path.join(Environment.DATA_PATH, "data.json");
            const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(jsonFile));
            fs.renameSync(tmpPath, filePath);
            return readData();
        } catch (e) {
            return Promise.reject(e);
        }
    });
}

export async function retrieveAnswers(): Promise<void> {
    try {
        const json = readJsonFile("answers.json", DEFAULT_ANSWERS);
        Environment.setAnswers(json);
        return Promise.resolve();
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return Promise.reject(e);
    }
}
