import * as fs from "fs";
import {Environment} from "../common/environment";
import {logError} from "../util/utils";
import {Answers} from "../model/answers";
import path from "node:path";

type DataJsonFile = {
    admins: number[]
    muted: number[]
}

export let jsonFile: DataJsonFile;

export async function readData(): Promise<void> {
    try {
        jsonFile = JSON.parse(fs.readFileSync(`${Environment.DATA_PATH}/data.json`).toString());

        const admins = jsonFile.admins || [];
        admins.unshift(Environment.CREATOR_ID);

        Environment.setAdmins(new Set<number>(admins));
        Environment.setMuted(new Set<number>(jsonFile.muted || []));

        return Promise.resolve();
    } catch (e) {
        logError(e);
        return Promise.reject(e);
    }
}

export async function readPrompts(): Promise<void> {
    try {
        const prompt = fs.readFileSync(path.join(Environment.DATA_PATH, "system_prompt.txt")).toString().trim();
        if (prompt.length) {
            Environment.setSystemPrompt(prompt);
        }
    } catch (e) {
        logError(e);
    }

    return Promise.resolve();
}

export async function saveData(): Promise<void> {
    const adminIds: number[] = [];
    Environment.ADMIN_IDS.forEach(id => adminIds.push(id));
    jsonFile.admins = adminIds;

    const mutedList: number[] = [];
    Environment.MUTED_IDS.forEach(id => mutedList.push(id));
    jsonFile.muted = mutedList;

    try {
        fs.writeFileSync(`${Environment.DATA_PATH}/data.json`, JSON.stringify(jsonFile));
        return readData();
    } catch (e) {
        return Promise.reject(e);
    }
}

export async function retrieveAnswers(): Promise<void> {
    try {
        const json: Answers = JSON.parse(fs.readFileSync(`${Environment.DATA_PATH}/answers.json`).toString());
        Environment.setAnswers(json);
        return Promise.resolve();
    } catch (e) {
        logError(e);
        return Promise.reject(e);
    }
}