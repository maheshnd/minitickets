// Entry point of the Pulumi program. It only imports layer files and exports their outputs.
// Each layer lives in src/. Later steps will add more imports here.
import * as network from "./src/network";

export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;
