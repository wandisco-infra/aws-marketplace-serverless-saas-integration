const AWS = require('aws-sdk');
const { NewSubscribersTableName: newSubscribersTableName, EntitlementQueueUrl: entitlementQueueUrl, MarketplaceSellerEmail: marketplaceSellerEmail, AWS_REGION:aws_region } = process.env;
const ses = new AWS.SES({ region: aws_region});
const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: aws_region });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05', region: aws_region });

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
  },

  body: JSON.stringify(body),
});

const setBuyerNotificationHandler = function (contactEmail) {
  if (typeof marketplaceSellerEmail == 'undefined') {
    return;
  }
  let params = {
    Destination: {
      ToAddresses: [contactEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no"><link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous"><link rel="stylesheet" href="https://d2ablbfnvxh95v.cloudfront.net/fonts.css"><link rel="stylesheet" href="https://d2ablbfnvxh95v.cloudfront.net/style.css"><title>Registration page</title></head><body class="text-center"><div class="container"><img src="https://d2ablbfnvxh95v.cloudfront.net/cirata-logo.svg" class="logo"><h1 class="form-signin-heading mb-3">Welcome!</h1><p>Thanks for purchasing</p><p>We are thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon</p></div></body></html>'
        },
        Text: {
          Charset: 'UTF-8',
          Data: 'Welcome! Thanks for purchasing. We are thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon'
        }
      },
      Subject: {
        Charset: 'UTF-8',
        Data: 'Welcome Email'
      }
    },
    Source: marketplaceSellerEmail,
  };

  return ses.sendEmail(params).promise()


};

exports.registerNewSubscriber = async (event) => {
  const {
    // Accept form inputs from ../web/index.html
    regToken, companyName, contactPerson, contactPhone, contactEmail,
  } = JSON.parse(event.body);

  // Validate the request with form inputs from ../web/index.html
  if (regToken && companyName && contactPerson && contactPhone && contactEmail) {
    try {
      // Call resolveCustomer to validate the subscriber
      const resolveCustomerParams = {
        RegistrationToken: regToken,
      };

      const resolveCustomerResponse = await marketplacemetering
        .resolveCustomer(resolveCustomerParams)
        .promise();

      // Store new subscriber data in dynamoDb
      const { CustomerIdentifier, ProductCode, CustomerAWSAccountId } = resolveCustomerResponse;

      const datetime = new Date().getTime().toString();

      // Write form inputs from ../web/index.html
      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Item: {
          companyName: { S: companyName },
          contactPerson: { S: contactPerson },
          contactPhone: { S: contactPhone },
          contactEmail: { S: contactEmail },
          customerIdentifier: { S: CustomerIdentifier },
          productCode: { S: ProductCode },
          customerAWSAccountID: { S: CustomerAWSAccountId },          
          created: { S: datetime },
        },
      };

      await dynamodb.putItem(dynamoDbParams).promise();

      // Only for SaaS Contracts, check entitlement
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
        await sqs.sendMessage(SQSParams).promise();
      }

      await setBuyerNotificationHandler(contactEmail);



      return lambdaResponse(200, 'Success! Registration completed. You have purchased an enterprise product that requires some additional setup. A representative from our team will be contacting you within two business days with your account credentials. Please contact Support through our website if you have any questions.');
    } catch (error) {
      console.error(error);
      return lambdaResponse(400, 'Registration data not valid. Please try again, or contact support!');
    }
  } else {
    return lambdaResponse(400, 'Request no valid');
  }
};
