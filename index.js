const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const AWS = require("aws-sdk");
const { RDSClient, DescribeDBInstancesCommand } = require("@aws-sdk/client-rds");

const rds = new AWS.RDS({ region: "us-east-1" });

const config = new pulumi.Config();

const vpcCidrBlock = config.require("vpcCidrBlock");
const publicRouteCidr = config.require("publicRouteCidr");
const region = config.require("region");
const ami = config.require("ami");
const key = config.require("key");
const hostedZoneId = config.require("zoneId");

AWS.config.update({ region: region });

// Fetch availability zones asynchronously
const availabilityZonesPromise = aws.getAvailabilityZones({
  state: "available",
}).then((result) => result.names.slice(0, 3)); // Slicing from index 0 to 2

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
    tags: { Name: "my-internet-gateway" },
  });

  // Create public and private subnets
  const publicSubnets = availabilityZones.map((az, index) => {
    const thirdOctet = index + 1;
    return new aws.ec2.Subnet(`publicSubnet-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `${vpcCidrBlock.split('.')[0]}.${vpcCidrBlock.split('.')[1]}.${thirdOctet}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: { Name: `public-subnet-${index}` },
    });
  });

  const privateSubnets = availabilityZones.map((az, index) => {
    const thirdOctet = index + 1;
    return new aws.ec2.Subnet(`privateSubnet-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `${vpcCidrBlock.split('.')[0]}.${vpcCidrBlock.split('.')[1]}.${(parseInt(thirdOctet) * 10)}.0/24`,
      availabilityZone: az,
      tags: { Name: `private-subnet-${index}` },
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
    tags: { Name: "public-route-table" },
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
    tags: { Name: "private-route-table" },
  });

  privateSubnets.forEach((subnet, index) => {
    const subnetAssoc = new aws.ec2.RouteTableAssociation(`privateSubnetAssoc-${index}`, {
      subnetId: subnet.id,
      routeTableId: privateRouteTable.id,
    });
  });

  // Create an Application Security Group
  const applicationSecurityGroup = new aws.ec2.SecurityGroup("applicationSecurityGroup", {
    vpcId: vpc.id,
    description: "Security group for web applications",
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: [publicRouteCidr] },
    ],
    tags: {
      Name: "application-sg",
    }
  });

  // Allow SSH (port 22) from anywhere
  new aws.ec2.SecurityGroupRule("allow-ssh", {
    type: "ingress",
    fromPort: 22,
    toPort: 22,
    protocol: "tcp",
    cidrBlocks: [publicRouteCidr],
    securityGroupId: applicationSecurityGroup.id,
  });

  // Allow HTTP (port 80) from anywhere
  new aws.ec2.SecurityGroupRule("allow-http", {
    type: "ingress",
    fromPort: 80,
    toPort: 80,
    protocol: "tcp",
    cidrBlocks: [publicRouteCidr],
    securityGroupId: applicationSecurityGroup.id,
  });

  // Allow HTTPS (port 443) from anywhere
  new aws.ec2.SecurityGroupRule("allow-https", {
    type: "ingress",
    fromPort: 443,
    toPort: 443,
    protocol: "tcp",
    cidrBlocks: [publicRouteCidr],
    securityGroupId: applicationSecurityGroup.id,
  });

  new aws.ec2.SecurityGroupRule("allow-app-port", {
    type: "ingress",
    fromPort: 8080,
    toPort: 8080,
    protocol: "tcp",
    cidrBlocks: [publicRouteCidr],
    securityGroupId: applicationSecurityGroup.id,
  });

  // Create an EC2 security group for RDS
  const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
    vpcId: vpc.id,
    description: "Security group for RDS",
    tags: {
      Name: "db-sg",
    },
  });

  // Allow incoming connections from the application security group
  new aws.ec2.SecurityGroupRule("allow-rds-from-app", {
    type: "ingress",
    toPort: 3306,
    fromPort: 3306,
    protocol: "tcp",
    sourceSecurityGroupId: applicationSecurityGroup.id,
    securityGroupId: dbSecurityGroup.id,
  });

  // Create a parameter group for RDS
  const dbParameterGroup = new aws.rds.ParameterGroup("dbParameterGroup", {
    family: "mariadb10.6",
    name: "custom-parameter-group",
    description: "Custom DB Parameter Group",
    parameters: [
      {
        name: "character_set_server",
        value: "utf8",
      },
      {
        name: "collation_server",
        value: "utf8_general_ci",
      },
      // Add other database-specific parameters here
    ],
  });

  // Create a DB Subnet Group
  const dbSubnetGroup = new aws.rds.SubnetGroup("my-db-subnet-group", {
    description: "My RDS Subnet Group",
    subnetIds: [privateSubnets[0].id, privateSubnets[1].id],
  });

  // Create an RDS instance
  const rdsInstanceCreate = new aws.rds.Instance("webappclouddb-rds-instance", {
    allocatedStorage: 20,
    storageType: "gp2",
    engine: "mariadb",
    engineVersion: "10.6",
    instanceClass: "db.t2.micro",
    username: "root",
    password: "password",
    dbName: "webappclouddb",
    skipFinalSnapshot: true,
    multiAz: false,
    publiclyAccessible: false,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    parameterGroupName: dbParameterGroup.name,
    dbSubnetGroupName: dbSubnetGroup.name,
    identifier: "webappclouddb-instance",
  });

  // Create an IAM role
  const role = new aws.iam.Role("role", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "ec2.amazonaws.com",
          },
          Effect: "Allow",
          Sid: "",
        },
      ],
    }),
  });

  // Attach CloudWatchAgentServerPolicy policy to IAM role
  new aws.iam.RolePolicyAttachment("rolePolicyAttachment", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
  });

  // Create an IAM instance profile for the role
  const instanceProfile = new aws.iam.InstanceProfile("myInstanceProfile", {
    role: role.name,
  });

  // Retrieve RDS details using AWS SDK v3
  pulumi.all([rdsInstanceCreate.identifier]).apply(async ([instanceId]) => {
    try {
      // Create an RDS client
      const rdsClient = new RDSClient({ region: region });

      // Describe the RDS instances
      const describeDBInstancesCommand = new DescribeDBInstancesCommand({});
      const response = await rdsClient.send(describeDBInstancesCommand);

      // Extract the details of the RDS instance
      const dbInstances = response.DBInstances;
      if (dbInstances.length > 0) {
        const dbInstance = dbInstances[0];
        const dbUsername = dbInstance.MasterUsername;
        const dbEndpoint = dbInstance.Endpoint.Address;
        const dbName = dbInstance.DBName;
        const dbDialect = "mysql";

        const user_data = `#!/bin/bash
        echo "DB_USERNAME=${dbUsername}" >> /opt/csye6225/webapp/.env
        echo "DB_PASSWORD=password" >> /opt/csye6225/webapp/.env
        echo "DB_HOST=${dbEndpoint}" >> /opt/csye6225/webapp/.env
        echo "DB_DATABASE=${dbName}" >> /opt/csye6225/webapp/.env
        echo "DB_DIALECT=${dbDialect}" >> /opt/csye6225/webapp/.env
        sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        -a fetch-config \
        -m ec2 \
        -c file:/opt/csye6225/webapp/cloudwatch-config.json \
        -s`;
        // Create an EC2 instance with the dynamic user data
        const ec2Instance = new aws.ec2.Instance("myEC2Instance", {
          ami: ami,
          keyName: key,
          iamInstanceProfile: instanceProfile.name,
          instanceType: "t2.micro",
          vpcSecurityGroupIds: [applicationSecurityGroup.id, dbSecurityGroup.id],
          subnetId: publicSubnets[0].id,
          rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
            deleteOnTermination: true,
          },
          associatePublicIpAddress: true,
          userData: user_data,
          tags: {
            Name: "my-ec2-instance",
          },
        });

        // Output the public IP of the EC2 instance
        exports.ec2PublicIp = ec2Instance.publicIp.apply((ip) => ip);

        // Create a DNS A record pointing to the EC2 instance's public IP
        const aRecord = new aws.route53.Record("my-a-record", {
          zoneId: hostedZoneId,
          name: "demo.anweshcloud.me",
          type: "A",
          ttl: 300,
          records: [ec2Instance.publicIp],
        });

        // Optionally export the DNS record's FQDN if needed
        exports.aRecordFQDN = aRecord.fqdn;
      } else {
        console.error("No RDS instance found.");
      }
    } catch (error) {
      console.error("Error retrieving RDS instance details:", error);
    }
  });
};

run();