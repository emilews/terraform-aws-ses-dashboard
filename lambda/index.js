var AWS = require('aws-sdk');
var sns = new AWS.SNS({ apiVersion: '2010-03-31' });
var sqs = new AWS.SQS({ region: process.env.Region, httpOptions: { agent: agent } });
var s3 = new AWS.S3();
var https = require('https');
var agent = new https.Agent({ maxSockets: 150 });
var fs = require('fs');
var queueURL = process.env.QueueURL;
var bucket = process.env.BucketName;
var prefix = process.env.BucketPrefix;
var emailToTopic = process.env.EmailReportToTopic;
var emailIntroductionMessage = process.env.EmailIntroductionMessage;
var qSize = null;
var content = null;
var queueParams = {AttributeNames: ["ApproximateNumberOfMessages"], QueueUrl: queueURL};


exports.handler = (event, context, callback) => {
    var date = (new Date()).toString().split(' ').splice(1, 4).join('-');
    var url = null;
    var messageCount = 0;
    
    function s3upload() {
        if (prefix == undefined) {
            prefix = "";
        }
        var param = {
            Bucket: bucket,
            Key: prefix + date + ".html",
            Body: content,
            ACL: 'public-read',
            ContentType: "text/html"
        };
        s3.upload(param, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            //else console.log(data);
            url = data.Location;
            console.log("uploading to s3");
            if (emailToTopic) {
                sendMail();
            }
            //context.done();
        });
    }

    function sendMail() {
        var emailMessage = `${emailIntroductionMessage}

There were ${messageCount} Bounced emails or complaints.

Please review the report at ${url}





Regards,


AWS SES Email Dashboard.







----------------------------------------------------------------
`;

        sns.publish({
            TargetArn: emailToTopic,
            Message: emailMessage
        }, function (err, data) {
            if (err) console.log(err, err.stack);
            //else console.log(data);
            console.log("sending email");
            context.done();
        });
    }

    function initializeQueue(callbackQueue) {
        console.log("Reading from: " + queueURL);
        sqs.getQueueAttributes(queueParams, (err, data) => {
            if (err) {
                console.log("Possible issue with SQS permissions or QueueURL wrong")
                callbackQueue(err, null);
            } 
            qSize = data.Attributes.ApproximateNumberOfMessages;
            callbackQueue(null, qSize);
        });
    }

    function deleteMessage(message) {
        sqs.deleteMessage({
            QueueUrl: queueURL,
            ReceiptHandle: message.ReceiptHandle
        }, (err, data) => {
            if (err) {
                console.log(err);
                throw err;
            }
        });
    }
    
    function row(type,btype,bsubtype,sender,destination,diagcode,smtpResponse,time,id) {
        var otr = "<tr>";
        var ftr = "</tr>";
        var oline = "<td>";
        var cline = "</td>";

        return otr + oline + type + cline + oline + btype + cline + oline + bsubtype + cline + oline + sender + cline + oline + destination + cline + oline + diagcode + cline + oline + smtpResponse + cline + oline + time + cline + oline + id + cline + ftr;
    }

    //Start Receive message
    initializeQueue((err, queueSize) => {
        console.log("Reading queue, size = " + queueSize);

        if (queueSize == 0) {
            callback(null, 'Queue is empty.');
        }

        var messages = [];
        var msgDelivery = [];
        var msgBouncePerm = [];
        var msgSuppres = [];
        var msgBounceTrans = [];
        var msgComplaint = [];

        for (var i = 0; i < queueSize; i++) {
            sqs.receiveMessage(queueParams, (err, data) => {
                if (err) {
                    console.log(err, err.stack);
                    throw err;
                }

                if (data.Messages) {
                    var message = data.Messages[0];
                    body = JSON.parse(message.Body);
                    msg = JSON.parse(body.Message);
                    try {
                        var destination = msg.mail.destination[0];
                        var sender = msg.mail.source;
                        var type = msg.notificationType;
                        var time = msg.mail.timestamp;
                        var id = msg.mail.messageId;
                        var smtpResponse = null;
                        var btype = null;
                        var bsubtype = null;
                        var diagcode = null;
    
                        if (type == "Bounce") {
                            btype = msg.bounce.bounceType; // Permanent || Transient
                            bsubtype = msg.bounce.bounceSubType; // General || Supressed
                            if (btype == "Permanent" && bsubtype == "Suppressed") {
                                diagcode = "Suppressed by SES";
                                msg.bounce.bouncedRecipients.forEach((recipient) => {
                                    text = row(type,btype,bsubtype,sender,recipient.emailAddress,diagcode,null,time,id);
                                    msgSuppres.push(text);
                                });
                            } else if (btype == "Permanent" && bsubtype == "General") {
                                msg.bounce.bouncedRecipients.forEach((recipient) => {
                                    diagcode = recipient.diagnosticCode;
                                    text = row(type,btype,bsubtype,sender,recipient.emailAddress,diagcode,null,time,id);
                                    consol
                                    msgBouncePerm.push(text);
                                });
                            } else if (btype == "Permanent" && bsubtype == "NoEmail") {
                                diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                text =row(type,btype,bsubtype,sender,destination,diagcode,null,time,id);
                                msgBouncePerm.push(text);
    
                            } else if (btype == "Undetermined") {
                                diagcode = msg.bounce.bouncedRecipients[0].diagnosticCode;
                                text = row(type,btype,bsubtype,sender,destination,diagcode,null,time,id);
                                msgBouncePerm.push(text);
    
                            } else if (btype == "Transient") {
                                diagcode = "soft-Bounce";
                                msg.bounce.bouncedRecipients.forEach((recipient) => {
                                    text = row(type,btype,bsubtype,sender,recipient.emailAddress,diagcode,null,time,id);
                                    msgBounceTrans.push(text);
                                });
                            } else {
                                console.log("it's an unknown bounce");
                                diagcode = "unknown";
                                text = row(type,btype,bsubtype,sender,destination,diagcode,null,time,id);
                                msgBouncePerm.push(text);
                            }
    
                        } else if (type == "Delivery") {
                            diagcode = "delivered";
                            smtpResponse = msg.delivery.smtpResponse;
                            text =row(type,btype,bsubtype,sender,destination,diagcode,smtpResponse,time,id);
                            msgDelivery.push(text);
    
                        } else if (type == "Complaint") {
                            btype = "null";
                            bsubtype = "null";
                            diagcode = "null";
                            text = row(type,btype,bsubtype,sender,destination,diagcode,null,time,id);
    
                            msgComplaint.push(text);
    
                        }
                        
                        else {
                            console.log("not identified");
                        }
                    } catch(err) {
                        console.log("Unexpected error, perhaps message type was not bounce/complaint. " + err.message + "\nMessage: " + msg);
                    }

                    messages.push(i);

                    deleteMessage(message);

                    if (messages.length == queueSize) {
                        var dl = msgDelivery.join('');
                        var bp = msgBouncePerm.join('');
                        var sp = msgSuppres.join('');
                        var bt = msgBounceTrans.join('');
                        var cp = msgComplaint.join('');
                        var begin = fs.readFileSync('template/begin.html', 'utf8');
                        var middle = dl + bp + sp + bt + cp;
                        var end = fs.readFileSync('template/end.html', 'utf8');
                        content = begin + middle + end;
                        messageCount = messages.length;
                        s3upload();
                    }
                } else {
                    console.log("data without messages.");
                }
            });
        }
    });
};
