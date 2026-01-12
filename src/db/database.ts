import * as fs from "fs";
import {Environment} from "../common/environment";


export let muted: Set<number> = new Set<number>();

type DataJsonFile = {
    admins: number[]
    muted: number[]
}

export let jsonFile: DataJsonFile;

type AnswersJsonFile = {
    test: string[]
    prefix: string[]
    better: string[]
    who: string[]
    kick: string[]
    invite: string[]
    day: number[]
}

export const testAnswers: string[] = [];
export const prefixAnswers: string[] = [];
export const betterAnswers: string[] = [];
export const whoAnswers: string[] = [];
export const kickAnswers: string[] = [];
export const inviteAnswers: string[] = [];
export const dayAnswers: number[] = [];

export async function addMute(id: number): Promise<boolean> {
    if (muted.has(id)) return Promise.resolve(false);

    muted.add(id);
    await saveData();
    return Promise.resolve(true);
}

export async function removeMute(id: number): Promise<boolean> {
    if (!muted.has(id)) return Promise.resolve(false);
    muted.delete(id);
    await saveData();
    return Promise.resolve(true);
}

export async function readData(): Promise<void> {
    try {
        jsonFile = JSON.parse(fs.readFileSync(`${Environment.DATA_PATH}/data.json`).toString());

        const admins = jsonFile.admins || [];
        admins.unshift(Environment.CREATOR_ID);

        Environment.setAdmins(new Set<number>(admins));

        muted = new Set<number>(jsonFile.muted || []);

        return Promise.resolve();
    } catch (e) {
        console.error(e);
        return Promise.reject(e);
    }
}

export async function saveData(): Promise<void> {
    const adminIds: number[] = [];
    Environment.ADMIN_IDS.forEach(id => adminIds.push(id));
    jsonFile.admins = adminIds;

    const mutedList: number[] = [];
    muted.forEach(id => mutedList.push(id));
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
        const json: AnswersJsonFile = JSON.parse(fs.readFileSync(`${Environment.DATA_PATH}/answers.json`).toString());
        json.test.forEach(e => testAnswers.push(e));
        json.prefix.forEach(e => prefixAnswers.push(e));
        json.better.forEach(e => betterAnswers.push(e));
        json.who.forEach(e => whoAnswers.push(e));
        json.kick.forEach(e => kickAnswers.push(e));
        json.invite.forEach(e => inviteAnswers.push(e));
        json.day.forEach(e => dayAnswers.push(e));
        return Promise.resolve();
    } catch (e) {
        console.error(e);
        return Promise.reject(e);
    }
}