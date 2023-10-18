const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");


const config = new pulumi.Config();

const vpcCidrBlock = config.require("vpcCidrBlock");
const publicRouteCidr = config.require("publicRouteCidr");
const region = config.require("region");


// Fetch availability zones asynchronously
const availabilityZonesPromise = aws.getAvailabilityZones({ 
    state: "available",

    // region: region
})
.then(result => result.names.slice(0, 3));  // Slicing from index 0 to 2


const run = async () => {
// Automatically calculate availability zones based on the region
const availabilityZones = await availabilityZonesPromise;

console.log("Availability Zones:", availabilityZones);

// Create a new VPC
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: vpcCidrBlock,
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
    const thirdOctet = index + 1;
    return new aws.ec2.Subnet(`publicSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `${vpcCidrBlock.split('.')[0]}.${vpcCidrBlock.split('.')[1]}.${thirdOctet}.0/24`,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: { Name: `public-subnet-${index}` }, // Assign names to public subnets
    });
});



const privateSubnets = availabilityZones.map((az, index) => {
    const thirdOctet = index + 1;
    return new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: `${vpcCidrBlock.split('.')[0]}.${vpcCidrBlock.split('.')[1]}.${(parseInt(thirdOctet) * 10)}.0/24`,
        availabilityZone: az,
        tags: { Name: `private-subnet-${index}` }, // Assign names to private subnets
    });
});



// Create a public route table and associate it with public subnets
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: publicRouteCidr,
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



// Create an Application Security Group
const appSecurityGroup = new aws.ec2.SecurityGroup("applicationSecurityGroup", {
    vpcId: vpc.id,
    egress: [
        {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    ingress: [
        {
            fromPort: 22,
            toPort: 22,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            fromPort: 80,
            toPort: 80,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    tags: {
        Name: "application-sg",
    },
});

const loginKey = "dev_keypair";

// Create an EC2 instance
const ec2Instance = new aws.ec2.Instance("myEC2Instance", {
    ami: "ami-0e235087c50ae3d7e", // Replace with your custom AMI ID
    keyName: loginKey,
    instanceType: "t2.micro", // Adjust instance type as needed
    vpcSecurityGroupIds: [appSecurityGroup.id],
    subnetId: publicSubnets[0].id, // Choose the subnet you want to launch in
    rootBlockDevice: {
        volumeSize: 25,
        volumeType: "gp2",
        deleteOnTermination: true,
    },
    associatePublicIpAddress: true,
    tags: {
        Name: "my-ec2-instance",
    },
});


// // Export VPC ID for other resources
// export const vpcId = vpc.id;
}

run();