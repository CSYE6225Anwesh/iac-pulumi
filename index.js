const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config = require("./config");  // Import the config

// Define your AWS region and availability zones
// const region = "us-east-1";
const availabilityZones = config.availabilityZones;  // Use the config

// Create a new VPC
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: config.vpcCidr,  // Use the config
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: "demo-vpc"},
});

// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway("myInternetGateway", {
    vpcId: vpc.id,
});

// Create public and private subnets
const publicSubnets = availabilityZones.map((az, index) => {
    return new aws.ec2.Subnet(`publicSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index}.0/24`,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
    });
});

const privateSubnets = availabilityZones.map((az, index) => {
    return new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${index + 3}.0/24`,
        availabilityZone: az,
    });
});

// Create a public route table and associate it with public subnets
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: config.publicRouteCidr,  // Use the config
            gatewayId: internetGateway.id,
        },
    ],
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
});

privateSubnets.forEach((subnet, index) => {
    const subnetAssoc = new aws.ec2.RouteTableAssociation(`privateSubnetAssoc-${index}`, {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
    });
});

// // Export VPC ID for other resources
// export const vpcId = vpc.id;
