import "dotenv/config";
import {defineConfig} from "drizzle-kit";
import {Environment} from "./src/common/environment";

export default defineConfig({
    out: "./drizzle",
    schema: "./src/db/schema.ts",
    dialect: "sqlite",
    dbCredentials: {
        url: Environment.DB_PATH,
    },
});
