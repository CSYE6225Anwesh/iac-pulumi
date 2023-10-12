# iac-pulumi

## Repository Name : iac-pulumi

## Git Url : git@github.com:AnweshPeddineni/iac-pulumi.git

## Installations

## AWS Command CLI

- run the msiexec command to run the MSI installer.

  msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

- sudo installer -pkg AWSCLIV2.pkg -target /

- Configure the AWS CLI for a profile named "dev" by executing:
- Set up AWS CLI configuration for a profile named "dev" by running the following command:
- aws configure --profile= dev
- You will be prompted to provide your Access Key ID, Secret Access Key, and the desired AWS Region for the account you've created.

- Similarly, configure the AWS CLI for a profile named "demo" with:
- Likewise, configure the AWS CLI for a profile called "demo" by running:
- aws configure --profile= demo
- During this setup, you'll be asked to enter your Access Key ID, Secret Access Key, and specify the AWS Region associated with the account you've created.

## Pulumi Creation

- pulumi new

## To Create Stacks

- Dev stack - pulumi stack init dev

- Demo Stack - pulumi stack init demo

## To Change Stacks

- pulumi stack select dev/demo

## To Remove Stacks

- pulumi stack rm dev/demo

## Create Pulumi

- pulumi up

## Destroy Pulumi

- pulumi destroy