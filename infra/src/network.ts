// LAYER: network
// NEEDS (inputs):   nothing (it is the first layer)
// CREATES:          vpc, internet gateway, 2 public subnets, 2 private subnets,
//                   public route table, private route table, 4 route table associations
// GIVES (outputs):  vpcId           -> used by security, target-groups
//                   publicSubnetIds -> used by service (api tasks), web-service (web tasks), alb
//                   privateSubnetIds -> used by postgres, cache
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";

// The network layer: a VPC with 2 public and 2 private subnets in 2 availability zones.
// See docs/12-infra-network.md for the diagrams.
//
// CIDR in simple words:
//   A CIDR block is a range of IP addresses, written like "10.0.0.0/16".
//   The number after the slash says how many of the 32 bits are FIXED. The rest are free.
//     /16 -> 16 bits free -> 65,536 addresses (the whole VPC)
//     /24 ->  8 bits free ->    256 addresses (one subnet)
//   Think of house numbers: 10.0.x.y. The VPC owns every address starting "10.0".
//   Each subnet owns one street inside it: 10.0.0.x, 10.0.1.x, 10.0.10.x, 10.0.11.x.
//   Subnets must never overlap, because one address can belong to only one street.
//   (AWS keeps 5 addresses in every subnet for itself, so 251 are usable.)

const prefix = "minitickets-dev";

export interface NetworkOutputs {
  vpcId: pulumi.Output<string>;
  publicSubnetIds: pulumi.Output<string>[];
  privateSubnetIds: pulumi.Output<string>[];
}

export function createNetwork(): NetworkOutputs {
  // 1. Ask AWS which availability zones (AZs) exist in our region and take the first 2.
  //    An AZ is one separate data centre. Using 2 means one can fail and the app lives on.
  const azs = aws.getAvailabilityZonesOutput({ state: "available" });
  const azNames = azs.names.apply((names) => names.slice(0, 2));

  // 2. VPC
  // WHAT: our own private, isolated network inside AWS (a private office building).
  // WHY: every other resource (database, containers) will live inside it.
  // DEPENDS ON: nothing.
  const vpc = new aws.ec2.Vpc(`${prefix}-vpc`, {
    cidrBlock: "10.0.0.0/16",
    // DNS support lets machines in the VPC look up names. DNS hostnames gives machines names
    // like "ip-10-0-0-5.ec2.internal". Later services (like RDS) need both to be reachable by name.
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: tagsFor(`${prefix}-vpc`),
  });

  // 3. Internet gateway
  // WHAT: the front door that connects the VPC to the public internet.
  // WHY: without it, nothing in the VPC can talk to the internet and the internet cannot reach us.
  // DEPENDS ON: vpc (passing vpcId attaches it).
  const internetGateway = new aws.ec2.InternetGateway(`${prefix}-igw`, {
    vpcId: vpc.id,
    tags: tagsFor(`${prefix}-igw`),
  });

  // 4. Public subnets, one per AZ
  // WHAT: a slice of the VPC's address range, living in ONE availability zone (a floor).
  // WHY: public things (the load balancer, later) go here. Two AZs means two floors in
  //      different buildings.
  // DEPENDS ON: vpc.
  // PUBLIC vs PRIVATE: the only difference is the route table the subnet uses (steps 6 and 7).
  //   Public = has a route to the internet gateway. Private = does not.
  //   The word "public" in the name does not do anything by itself.
  const publicCidrs = ["10.0.0.0/24", "10.0.1.0/24"];
  const publicSubnets = publicCidrs.map(
    (cidrBlock, i) =>
      new aws.ec2.Subnet(`${prefix}-public-${i + 1}`, {
        vpcId: vpc.id,
        cidrBlock,
        availabilityZone: azNames.apply((names) => names[i]),
        // Things launched here get a public IP automatically, so the internet can reach them.
        mapPublicIpOnLaunch: true,
        tags: tagsFor(`${prefix}-public-${i + 1}`),
      }),
  );

  // 5. Private subnets, one per AZ
  // WHAT: same as above, but with NO route to the internet.
  // WHY: databases and other things that must never be reachable from the internet go here.
  // DEPENDS ON: vpc.
  const privateCidrs = ["10.0.10.0/24", "10.0.11.0/24"];
  const privateSubnets = privateCidrs.map(
    (cidrBlock, i) =>
      new aws.ec2.Subnet(`${prefix}-private-${i + 1}`, {
        vpcId: vpc.id,
        cidrBlock,
        availabilityZone: azNames.apply((names) => names[i]),
        mapPublicIpOnLaunch: false,
        tags: tagsFor(`${prefix}-private-${i + 1}`),
      }),
  );

  // 6. Public route table
  // WHAT: a signboard listing where traffic leaving a subnet should go.
  // WHY: the rule 0.0.0.0/0 (meaning "every address") -> internet gateway is what makes
  //      a subnet public.
  // DEPENDS ON: vpc, internetGateway (the route points at it).
  const publicRouteTable = new aws.ec2.RouteTable(`${prefix}-public-rt`, {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: internetGateway.id }],
    tags: tagsFor(`${prefix}-public-rt`),
  });

  // 7. Private route table
  // WHAT: a signboard with NO internet route. AWS adds the built-in "local" route by itself,
  //       so subnets inside the VPC can still talk to each other.
  // WHY: this is what makes a subnet private.
  // DEPENDS ON: vpc.
  // NO NAT gateway: a NAT gateway lets private things start connections to the internet. It costs
  //   about $30+/month and our databases never need the internet, so we skip it. In real
  //   production, private app containers need to pull images and call APIs, so we would add a
  //   NAT gateway or VPC endpoints.
  const privateRouteTable = new aws.ec2.RouteTable(`${prefix}-private-rt`, {
    vpcId: vpc.id,
    tags: tagsFor(`${prefix}-private-rt`),
  });

  // 8. Associations
  // WHAT: the link that says "this subnet uses that route table".
  // WHY: a route table does nothing until subnets are linked to it. (An unlinked subnet falls
  //      back to the VPC's default route table, which is easy to forget about.)
  // DEPENDS ON: the subnet and the route table it connects.
  publicSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(`${prefix}-public-rta-${i + 1}`, {
      subnetId: subnet.id,
      routeTableId: publicRouteTable.id,
    });
  });
  privateSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(`${prefix}-private-rta-${i + 1}`, {
      subnetId: subnet.id,
      routeTableId: privateRouteTable.id,
    });
  });

  // 9. What later layers need. index.ts passes these on; no other file imports them.
  return {
    vpcId: vpc.id,
    publicSubnetIds: publicSubnets.map((s) => s.id),
    privateSubnetIds: privateSubnets.map((s) => s.id),
  };
}
