// Entry point of the Pulumi program. It only imports layer files and exports their outputs.
// Each layer lives in src/. Later steps will add more imports here.
import * as network from "./src/network";
import * as security from "./src/security";
import "./src/budget"; // creates the budget; nothing to export

export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;

export const albSgId = security.albSgId;
export const webSgId = security.webSgId;
export const apiSgId = security.apiSgId;
export const dbSgId = security.dbSgId;
export const redisSgId = security.redisSgId;
