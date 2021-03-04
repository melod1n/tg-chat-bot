import * as fs from "fs";
import {arrayRemove, IS_DEBUG, setTestAnswers} from "./base";

export let adminsList: number[] = []
export let chatsList = []
export let usersList = []
export let notesList = []
export let mutedList: number[] = []

let jsonFile

export function setAdmins(admins: number[]) {
    adminsList = admins
}

export function setChats(chats: any[]) {
    chatsList = chats
}

export function setUsers(users: any[]) {
    usersList = users
}

export function setNotes(notes: any[]) {
    notesList = notes
}

export function setMuted(newMuted: number[]) {
    mutedList = newMuted
}

export function addMute(id: number) {
    const index = searchMuted(id)
    if (index >= 0) return false

    mutedList.push(id)

    saveData()
    return true
}

export function removeMute(id: number) {
    const index = searchMuted(id)

    if (index >= 0) {
        setMuted(arrayRemove(mutedList, mutedList[index]))
        saveData()
        return true
    }

    return false
}

export function searchMuted(id: number) {
    for (let i = 0; i < mutedList.length; i++) {
        if (mutedList[i] == id) return i
    }

    return -1
}

export function readData() {
    try {
        // @ts-ignore
        jsonFile = JSON.parse(fs.readFileSync(IS_DEBUG ? 'debug_data.json' : 'data.json'))

        adminsList = jsonFile.admins
        chatsList = jsonFile.chats
        usersList = jsonFile.users
        notesList = jsonFile.notes
        mutedList = jsonFile.muted

        return 'success'
    } catch (e) {
        console.error(e)
        return e.toString()
    }
}

export function saveData() {
    jsonFile.admins = adminsList
    jsonFile.chats = chatsList
    jsonFile.users = usersList
    jsonFile.notes = notesList
    jsonFile.muted = mutedList

    fs.writeFileSync(IS_DEBUG ? 'debug_data.json' : 'data.json', JSON.stringify(jsonFile))

    readData()

    return 'success'
}

export function retrieveAnswers() {
    try {
        // @ts-ignore
        const json = JSON.parse(fs.readFileSync('answers.json'))

        setTestAnswers(json.test)
        return 'success'
    } catch (e) {
        console.error(e)
        return e.toString()
    }

    // fetch(answersUrl, {method: "Get"})
    //     .then(r => {
    //         const json = r.json()
    //         testAnswers = json.test
    //         console.log('success retrieved answers')
    //     })
}