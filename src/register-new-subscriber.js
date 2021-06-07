const AWS = require('aws-sdk');
var ses = new AWS.SES({ region: "us-east-1" });
const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05', region: 'us-east-1' });
const { NewSubscribersTableName: newSubscribersTableName, EntitlementQueueUrl: entitlementQueueUrl, MarketplaceSellerEmail } = process.env;

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
  },

  body: JSON.stringify(body),
});

let setBuyerNotificationHandler = function (contactEmail) {
  console.log(contactEmail);
  var params = {
    Destination: {
      ToAddresses: [contactEmail],
    },
    Message: {
      Body: {
        Html: {
       Charset: "UTF-8",
       Data: "<!DOCTYPE html><html><head><title>Welcome!<\/title><\/head><body><h1>Welcome!<\/h1><h2>Thanks for purchasing<\/h2><p>We\u2019re thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon. For reference, our records indicate you made the following purchase: User accountIf you have any questions, feel free to email our customer success team. Thanks<\/p><\/body><\/html>"
      },
        Text: { Charset: "UTF-8",
Data: "Welcome, Sgtest! Thanks for purchasing WUPHF.com. We’re thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon. For reference, our records indicate you made the following purchase: User accountIf you have any questions, feel free to email our customer success team. Thanks, The WUPHF.com Team" }
      },

      Subject: { 
        Charset: 'UTF-8',
        Data: "WUPHF.com" }
    },
    Source: process.env.MarketplaceSellerEmail,
  };
 
  return ses.sendEmail(params).promise()
};

exports.registerNewSubscriber = async (event) => {
  const {
    regToken, companyName, contactPerson, contactPhone, contactEmail,
  } = JSON.parse(event.body);

  // Validate the request
  if (regToken && companyName && contactPerson && contactPhone && contactEmail) {
    try {
      // Call resolveCustomer to validate the subscirber
      const resolveCustomerParams = {
        RegistrationToken: regToken,
      };

      const resolveCustomerResponse = await marketplacemetering
        .resolveCustomer(resolveCustomerParams)
        .promise();

      // Store new subscirber data in dynmoDb
      const { CustomerIdentifier, ProductCode } = resolveCustomerResponse;

      const datetime = new Date().getTime().toString();

      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Item: {
          companyName: { S: companyName },
          contactPerson: { S: contactPerson },
          contactPhone: { S: contactPhone },
          contactEmail: { S: contactEmail },
          customerIdentifier: { S: CustomerIdentifier },
          productCode: { S: ProductCode },
          created: { S: datetime },
        },
      };

      await dynamodb.putItem(dynamoDbParams).promise();

      // Only for SaaS Contracts, check entitelment
      if (entitlementQueueUrl) {
        const SQSParams = {
          MessageBody: `{ 
              "Type": "Notification", 
              "Message" : {
                  "action" : "entitlement-updated",
                  "customer-identifier": "${CustomerIdentifier}",
                  "product-code" : "${ProductCode}"
                  } 
              }`,
          QueueUrl: entitlementQueueUrl,
        };
        console.log("sqsstarted");
        await sqs.sendMessage(SQSParams).promise();
      }
       console.log("sesstart");
       await setBuyerNotificationHandler(contactEmail);
       console.log("sesdone");


      return lambdaResponse(200, 'Thank you for registering. Please check your email for a confirmation!');
    } catch (error) {
      console.error(error.message);
      return lambdaResponse(400, error.message);
    }
  } else {
    return lambdaResponse(400, 'Request no valid');
  }
};
