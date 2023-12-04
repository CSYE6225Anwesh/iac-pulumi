const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
const AWS = require("aws-sdk");
const {
  RDSClient,
  DescribeDBInstancesCommand,
} = require("@aws-sdk/client-rds");

const rds = new AWS.RDS({ region: "us-east-1" });

const config = new pulumi.Config();

const vpcCidrBlock = config.require("vpcCidrBlock");
const publicRouteCidr = config.require("publicRouteCidr");
const region = config.require("region");
const ami = config.require("ami");
const key = config.require("key");
const hostedZoneId = config.require("zoneId");
const lambdaFunctionCodePath = config.require("lambdaFunctionCodePath");

AWS.config.update({ region: region });

// Fetch availability zones asynchronously
const availabilityZonesPromise = aws
  .getAvailabilityZones({
    state: "available",
  })
  .then((result) => result.names.slice(0, 3)); // Slicing from index 0 to 2

const run = async () => {
  // Automatically calculate availability zones based on the region
  const availabilityZones = await availabilityZonesPromise;

  console.log("Availability Zones:", availabilityZones);

  var snsTopic = new aws.sns.Topic("mySNSTopic", {
    displayName: "My SNS Topic",
  });
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
      cidrBlock: `${vpcCidrBlock.split(".")[0]}.${
        vpcCidrBlock.split(".")[1]
      }.${thirdOctet}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: { Name: `public-subnet-${index}` },
    });
  });

  const privateSubnets = availabilityZones.map((az, index) => {
    const thirdOctet = index + 1;
    return new aws.ec2.Subnet(`privateSubnet-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `${vpcCidrBlock.split(".")[0]}.${vpcCidrBlock.split(".")[1]}.${
        parseInt(thirdOctet) * 10
      }.0/24`,
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
    const subnetAssoc = new aws.ec2.RouteTableAssociation(
      `publicSubnetAssoc-${index}`,
      {
        subnetId: subnet.id,
        routeTableId: publicRouteTable.id,
      }
    );
  });

  // Create a private route table and associate it with private subnets
  const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags: { Name: "private-route-table" },
  });

  privateSubnets.forEach((subnet, index) => {
    const subnetAssoc = new aws.ec2.RouteTableAssociation(
      `privateSubnetAssoc-${index}`,
      {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
      }
    );
  });

  // Create an Application Security Group
  const applicationSecurityGroup = new aws.ec2.SecurityGroup(
    "applicationSecurityGroup",
    {
      vpcId: vpc.id,
      description: "Security group for web applications",
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: [publicRouteCidr],
        },
      ],
      tags: {
        Name: "application-sg",
      },
    }
  );

  // Create an EC2 security group for RDS
  const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
    vpcId: vpc.id,
    description: "Security group for RDS",
    tags: {
      Name: "db-sg",
    },
  });

  // Crete a load balancer security group
  const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup(
    "loadBalancerSecurityGroup",
    {
      vpcId: vpc.id,
      description: "Security group for the load balancer",
      egress: [
        { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
      ],
    }
  );

  //LOAD BALANCER SG RULES
  //attach egress rule for load balancer security group  with source as application security group
  // new aws.ec2.SecurityGroupRule("lb-egress-all-traffic", {
  //   type: "egress",
  //   fromPort: 0,
  //   toPort: 0,
  //   protocol: "-1",
  //   cidrBlocks: [publicRouteCidr],
  //   securityGroupId: loadBalancerSecurityGroup.id,
  // });

  //attach egress rule for loadbalancer security group for port 8080 with source as application security group
  new aws.ec2.SecurityGroupRule("lb-egress-app-port", {
    type: "egress",
    fromPort: 8080,
    toPort: 8080,
    protocol: "tcp",
    // cidrBlocks: ["0.0.0.0/0"],
    sourceSecurityGroupId: applicationSecurityGroup.id,
    securityGroupId: loadBalancerSecurityGroup.id,
  });

  // Allow SSH (port 22) from anywhere
  new aws.ec2.SecurityGroupRule("allow-ssh", {
    type: "ingress",
    fromPort: 22,
    toPort: 22,
    protocol: "tcp",
    sourceSecurityGroupId: loadBalancerSecurityGroup.id, // Allow traffic from the load balancer
    securityGroupId: applicationSecurityGroup.id,
  });

  //   // Allow HTTP (port 80) from anywhere
  //   new aws.ec2.SecurityGroupRule("allow-http", {
  //     type: "ingress",
  //     fromPort: 80,
  //     toPort: 80,
  //     protocol: "tcp",
  //     cidrBlocks: [publicRouteCidr],
  //     securityGroupId: applicationSecurityGroup.id,
  //   });

  //   // Allow HTTPS (port 443) from anywhere
  //   new aws.ec2.SecurityGroupRule("allow-https", {
  //     type: "ingress",
  //     fromPort: 443,
  //     toPort: 443,
  //     protocol: "tcp",
  //     cidrBlocks: [publicRouteCidr],
  //     securityGroupId: applicationSecurityGroup.id,
  //   });

  new aws.ec2.SecurityGroupRule("allow-app-port", {
    type: "ingress",
    fromPort: 8080,
    toPort: 8080,
    protocol: "tcp",
    sourceSecurityGroupId: loadBalancerSecurityGroup.id, // Allow traffic from the load balancer
    securityGroupId: applicationSecurityGroup.id,
  });

  

  // Allow HTTPS traffic (port 443) from anywhere
  new aws.ec2.SecurityGroupRule("allow-https", {
    type: "ingress",
    fromPort: 443,
    toPort: 443,
    protocol: "tcp",
    cidrBlocks: [publicRouteCidr], // Allow traffic from anywhere
    securityGroupId: loadBalancerSecurityGroup.id,
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
    dbName: "webapp",
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
  pulumi.all([snsTopic.arn]).apply(async ([topicArn]) => {
    try {
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
        echo "TOPIC_ARN=${topicArn}" >> /opt/csye6225/webapp/.env
        sudo systemctl daemon-reload
        sudo systemctl restart web-app
        sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        -a fetch-config \
        -m ec2 \
        -c file:/opt/csye6225/webapp/cloudwatch-config.json \
        -s`;

            const base64UserData = Buffer.from(user_data).toString("base64");

            //Step1: Launch Template
            const launchTemplate = new aws.ec2.LaunchTemplate(
              "myLaunchTemplate",
              {
                name: "my-launch-template",
                blockDeviceMappings: [
                  {
                    deviceName: "/dev/xvda",
                    ebs: {
                      volumeSize: 25,
                      volumeType: "gp2",
                      deleteOnTermination: true,
                    },
                  },
                ],
                instanceType: "t2.micro",
                imageId: ami,
                keyName: key,
                iamInstanceProfile: {
                  name: instanceProfile.name,
                },
                vpcSecurityGroupIds: [
                  applicationSecurityGroup.id,
                  dbSecurityGroup.id,
                ],
                userData: base64UserData,
                subnetId: publicSubnets[0].id,
              }
            );

            // Step 4: Create an Application Load Balancer
            const loadBalancer = new aws.lb.LoadBalancer("myLoadBalancer", {
              internal: false, // Set to true if it's an internal ALB.
              loadBalancerType: "application",
              securityGroups: [loadBalancerSecurityGroup.id],
              subnets: publicSubnets.map((subnet) => subnet.id),
            });

            //Target Group
            const targetGroup = new aws.lb.TargetGroup("AppTargetGroup", {
              port: 8080,
              protocol: "HTTP",
              vpcId: vpc.id,
              targetType: "instance",
              healthCheck: {
                healthyThreshold: 10,
                unhealthyThreshold: 5,
                timeout: 10,
                interval: 30,
                protocol: "HTTP",
                path: "/healthz",
                port: "8080",
                matcher: "200",
              },
            });

            const selectedCertificate = aws.acm.getCertificate({
              domain: "www.demo.anweshcloud.me",
              mostRecent: true,
            }, { async: true }).then(certificate => certificate.arn);

            // Create an AWS Listener for the Load Balancer
            const listener = new aws.lb.Listener("front_end", {
              loadBalancerArn: loadBalancer.arn,
              port: 443,
              protocol: "HTTPS",
              sslPolicy: "ELBSecurityPolicy-2016-08",
              certificateArn: selectedCertificate,
              defaultActions: [
                {
                  type: "forward",
                  targetGroupArn: targetGroup.arn,
                },
              ],
            });

            const aRecord = new aws.route53.Record("my-a-record", {
              zoneId: hostedZoneId,
              name: "demo.anweshcloud.me",
              type: "A",
              aliases: [
                {
                  name: loadBalancer.dnsName,
                  zoneId: loadBalancer.zoneId,
                  evaluateTargetHealth: true,
                },
              ],
            });

            // Optionally export the DNS record's FQDN if needed
            exports.aRecordFQDN = aRecord.fqdn;

            // Step 2: Create an Auto Scaling Group
            const autoScalingGroup = new aws.autoscaling.Group(
              "myAutoScalingGroup",
              {
                launchTemplate: {
                  id: launchTemplate.id,
                  version: launchTemplate.latestVersion,
                },
                name:"myAutoScalingGroup",
                minSize: 1,
                maxSize: 3,
                desiredCapacity: 1,
                healthCheckType: "EC2",
                healthCheckGracePeriod: 300,
                forceDelete: true,
                tags: [
                  {
                    key: "Name",
                    value: "MyAutoScalingGroup",
                    propagateAtLaunch: true,
                  },
                ],
                vpcZoneIdentifiers: publicSubnets.map((subnet) => subnet.id),
                targetGroupArns: [targetGroup.arn], // Assuming you have a target group for the ALB.
                cooldown: 60,
                // ... other Auto Scaling Group configurations ...
              }
            );

            // Step 3: Create Auto Scaling Policies
            const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
              scalingAdjustment: 1,
              adjustmentType: "ChangeInCapacity",
              cooldown: 60,
              autoscalingGroupName: autoScalingGroup.name,
              policyType: "SimpleScaling",
              metricAggregationType: "Average",
            });

            const scaleDownPolicy = new aws.autoscaling.Policy(
              "scaleDownPolicy",
              {
                scalingAdjustment: -1,
                adjustmentType: "ChangeInCapacity",
                cooldown: 60,
                autoscalingGroupName: autoScalingGroup.name,
                policyType: "SimpleScaling",
                metricAggregationType: "Average",
              }
            );

            const cpuUsageAlarm = new aws.cloudwatch.MetricAlarm(
              "cpuUsageAlarm",
              {
                comparisonOperator: "GreaterThanThreshold",
                evaluationPeriods: 2,
                metricName: "CPUUtilization",
                namespace: "AWS/EC2",
                period: 60,
                statistic: "Average",
                threshold: 3,
                alarmActions: [scaleUpPolicy.arn],
                dimensions: {
                  AutoScalingGroupName: autoScalingGroup.name,
                },
              }
            );

            const scaleDownAlarm = new aws.cloudwatch.MetricAlarm(
              "scaleDownAlarm",
              {
                comparisonOperator: "LessThanThreshold",
                evaluationPeriods: 2,
                metricName: "CPUUtilization",
                namespace: "AWS/EC2",
                period: 60,
                statistic: "Average",
                threshold: 1,
                alarmActions: [scaleDownPolicy.arn],
                dimensions: {
                  AutoScalingGroupName: autoScalingGroup.name,
                },
              }
            );
          } else {
            console.error("No RDS instance found.");
          }
        } catch (error) {
          console.error("Error retrieving RDS instance details:", error);
        }
      });

      const snsPublishPolicy = new aws.iam.Policy("snsPublishPolicy", {
        policy: pulumi.interpolate`{
         "Version": "2012-10-17",
         "Statement": [
           {
             "Effect": "Allow",
             "Action": "sns:Publish",
             "Resource": "${snsTopic.arn}"
           }
         ]
       }`,
      });
    
    
      // Attach the Policy to the EC2 Role
      const rolePolicyAttachment = new aws.iam.RolePolicyAttachment(
        "snsPublishRolePolicyAttachment",
        {
          role: role.name,
          policyArn: snsPublishPolicy.arn,
        }
      );
    } catch (error) {
      console.error("Error retrieving SNS instance details:", error);
    }
  });

  // Create an SNS topic

  // // Create an IAM role
  // const snsPublishRole = new aws.iam.Role("snsPublishRole", {
  //   assumeRolePolicy: JSON.stringify({
  //     Version: "2012-10-17",
  //     Statement: [
  //       {
  //         Action: "sts:AssumeRole",
  //         Effect: "Allow",
  //         Principal: {
  //           Service: "sns.amazonaws.com",
  //         },
  //       },
  //     ],
  //   }),
  // });

  // Create a policy that allows publishing to the SNS topic

  // // Example IAM role policy for SNS permissions
  // const snsRolePolicy = new aws.iam.RolePolicy("snsRolePolicy", {
  //   role: role.name,
  //   policy: {
  //     Version: "2012-10-17",
  //     Statement: [
  //       {
  //         Effect: "Allow",
  //         Action: "sns:Publish",
  //         Resource: snsTopic.arn,
  //       },
  //     ],
  //   },
  // });

  // // Optionally, you can subscribe an email address to the SNS topic
  // const emailSubscription = new aws.sns.TopicSubscription("emailSubscription", {
  //   endpoint: "anwesh.peddineni+demo@gmail.com", // Replace with your email address
  //   protocol: "email",
  //   topic: snsTopic.arn,
  // });

  // Create a Google Cloud Storage bucket
  const bucket = new gcp.storage.Bucket("my-bucket", {
    location: "US",
    forceDestroy: "true",
  });

  // Create a Google Service Account
  const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
    accountId: "cloud-demo-account-01",
    displayName: "My Service Account",
  });

  // Create a service account key
  const serviceAccountKey = new gcp.serviceaccount.Key("myServiceAccountKey", {
    serviceAccountId: serviceAccount.name,
  });

  const gcpBucketIAMBinding = new gcp.storage.BucketIAMMember(
    "bucketIAMMember",
    {
      bucket: bucket.id,
      role: "roles/storage.objectCreator",
      member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
    }
  );

  // DynamoDB table for tracking emails
  const emailTable = new aws.dynamodb.Table("emailTable", {
    attributes: [{ name: "id", type: "S" }],
    hashKey: "id",
    billingMode: "PAY_PER_REQUEST",
  });

  // IAM role for the Lambda function
  const lambdaRole = new aws.iam.Role("lambdaRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "lambda.amazonaws.com",
          },
          Effect: "Allow",
        },
      ],
    }),
  });

  // const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
  //   policy: JSON.stringify({
  //     Version: "2012-10-17",
  //     Statement: [
  //       {
  //         Action: ["dynamodb:", "logs:", "cloudwatch:*"],
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //   }),
  // });

  const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: [
            "dynamodb:PutItem",
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogStreams",
            "cloudwatch:PutMetricData",
            "cloudwatch:GetMetricStatistics",
            "cloudwatch:ListMetrics",
            "cloudwatch:DescribeAlarms",
            "cloudwatch:PutMetricAlarm",
            "cloudwatch:GetMetricWidgetImage",
            "cloudwatch:GetMetricData",
            "cloudwatch:SetAlarmState",
          ],
          Effect: "Allow",
          Resource: "*",
        },
      ],
    }),
  });

  const lambdaPolicyAttachment = new aws.iam.RolePolicyAttachment(
    "lambdaPolicyAttachment",
    {
      role: lambdaRole.name,
      policyArn: lambdaPolicy.arn,
    }
  );

  // Lambda function
const lambdaFunction = new aws.lambda.Function("myLambdaFunction", {
  code: new pulumi.asset.FileArchive(lambdaFunctionCodePath),
  handler: "index.handler",
  //timeout: 60,
  role: lambdaRole.arn,
  runtime: "nodejs18.x",
  environment: {
      variables: {
          SNS_TOPIC_ARN: snsTopic.arn,
          DYNAMODB_TABLE_NAME: emailTable.name,
          GCS_BUCKET_NAME: bucket.name,
          GCS_SERVICE_ACCOUNT_KEY: serviceAccountKey.privateKey,
          MAILGUN_API_KEY: "a2bc218bad38f1c5a936c8c1a7d27fae-30b58138-e82c2cd5",
          MAILGUN_DOMAIN: "demo.anweshcloud.me",
          GOOGLE_CLIENT_MAIL: serviceAccount.email,
          GOOGLE_PROJECT_ID: "cloud-demo-406223",
      },
  },
});

  // Grant SNS permissions to invoke the lambda function
  const snsInvokeLambda = new aws.lambda.Permission("snsInvokeLambda", {
    action: "lambda:InvokeFunction",
    function: lambdaFunction,
    principal: "sns.amazonaws.com",
    sourceArn: snsTopic.arn,
  });

  // Configure SNS topic to trigger lambda function
  const lambdaTrigger = new aws.sns.TopicSubscription("lambdaTrigger", {
    endpoint: lambdaFunction.arn.apply((arn) => arn),
    protocol: "lambda",
    topic: snsTopic.arn,
  });
};

run();



