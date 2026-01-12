import "dotenv/config";
import {drizzle, LibSQLDatabase} from "drizzle-orm/libsql";
import {Environment} from "../common/environment";

export class DatabaseManager {

    static db: LibSQLDatabase;

    static init() {
        try {
            DatabaseManager.db = drizzle(Environment.DB_PATH);
        } catch (e) {
            console.error(e);
        }
    }
}