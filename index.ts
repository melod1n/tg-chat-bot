import {initSystemSpecs} from "./base/base";
import {readData, retrieveAnswers} from "./base/db";
import {startBot} from "./base/net";


initSystemSpecs()

readData()
retrieveAnswers()
startBot()