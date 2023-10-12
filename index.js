const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config = require("./config");  // Import the config

// Define your AWS region and availability zones
// const region = "us-east-1";
const availabilityZones = config.availabilityZones;  // Use the config

// Create a new VPC
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: config.vpcCidrBlock, // Use the CIDR block from the configuration
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: "my-vpc" },
});

// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway("myInternetGateway", {
    vpcId: vpc.id,
    tags: { Name: "my-internet-gateway" }, // Assign a name to the Internet Gateway
});

// Create public and private subnets
const publicSubnets = availabilityZones.map((az, index) => {
    return new aws.ec2.Subnet(`publicSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index}.0/24`,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: { Name: `public-subnet-${index}` }, // Assign names to public subnets
    });
});

const privateSubnets = availabilityZones.map((az, index) => {
    return new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index + 3}.0/24`,
        availabilityZone: az,
        tags: { Name: `private-subnet-${index}` }, // Assign names to private subnets
    });
});

// Create a public route table and associate it with public subnets
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: config.publicRouteCidr,
            gatewayId: internetGateway.id,
        },
    ],
    tags: { Name: "public-route-table" }, // Assign a name to the public route table
});

publicSubnets.forEach((subnet, index) => {
    const subnetAssoc = new aws.ec2.RouteTableAssociation(`publicSubnetAssoc-${index}`, {
        subnetId: subnet.id,
        routeTableId: publicRouteTable.id,
    });
});

// Create a private route table and associate it with private subnets
const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags: { Name: "private-route-table" }, // Assign a name to the private route table
});

privateSubnets.forEach((subnet, index) => {
    const subnetAssoc = new aws.ec2.RouteTableAssociation(`privateSubnetAssoc-${index}`, {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
    });
});

// // Export VPC ID for other resources
// export const vpcId = vpc.id;
