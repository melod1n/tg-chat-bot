"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const base_1 = require("./base");
exports.adminsList = [];
exports.chatsList = [];
exports.usersList = [];
exports.notesList = [];
exports.mutedList = [];
let jsonFile;
function setAdmins(admins) {
    exports.adminsList = admins;
}
exports.setAdmins = setAdmins;
function setChats(chats) {
    exports.chatsList = chats;
}
exports.setChats = setChats;
function setUsers(users) {
    exports.usersList = users;
}
exports.setUsers = setUsers;
function setNotes(notes) {
    exports.notesList = notes;
}
exports.setNotes = setNotes;
function setMuted(newMuted) {
    exports.mutedList = newMuted;
}
exports.setMuted = setMuted;
function addMute(id) {
    const index = searchMuted(id);
    if (index >= 0)
        return false;
    exports.mutedList.push(id);
    saveData();
    return true;
}
exports.addMute = addMute;
function removeMute(id) {
    const index = searchMuted(id);
    if (index >= 0) {
        setMuted(base_1.arrayRemove(exports.mutedList, exports.mutedList[index]));
        saveData();
        return true;
    }
    return false;
}
exports.removeMute = removeMute;
function searchMuted(id) {
    for (let i = 0; i < exports.mutedList.length; i++) {
        if (exports.mutedList[i] == id)
            return i;
    }
    return -1;
}
exports.searchMuted = searchMuted;
function readData() {
    try {
        // @ts-ignore
        jsonFile = JSON.parse(fs.readFileSync(base_1.IS_DEBUG ? 'debug_data.json' : 'data.json'));
        exports.adminsList = jsonFile.admins;
        exports.chatsList = jsonFile.chats;
        exports.usersList = jsonFile.users;
        exports.notesList = jsonFile.notes;
        exports.mutedList = jsonFile.muted;
        return 'success';
    }
    catch (e) {
        console.error(e);
        return e.toString();
    }
}
exports.readData = readData;
function saveData() {
    jsonFile.admins = exports.adminsList;
    jsonFile.chats = exports.chatsList;
    jsonFile.users = exports.usersList;
    jsonFile.notes = exports.notesList;
    jsonFile.muted = exports.mutedList;
    fs.writeFileSync(base_1.IS_DEBUG ? 'debug_data.json' : 'data.json', JSON.stringify(jsonFile));
    readData();
    return 'success';
}
exports.saveData = saveData;
function retrieveAnswers() {
    try {
        // @ts-ignore
        const json = JSON.parse(fs.readFileSync('answers.json'));
        base_1.setTestAnswers(json.test);
        return 'success';
    }
    catch (e) {
        console.error(e);
        return e.toString();
    }
    // fetch(answersUrl, {method: "Get"})
    //     .then(r => {
    //         const json = r.json()
    //         testAnswers = json.test
    //         console.log('success retrieved answers')
    //     })
}
exports.retrieveAnswers = retrieveAnswers;
//# sourceMappingURL=db.js.map