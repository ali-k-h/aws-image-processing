/** environment variables functionName, region*/

var async = require('async');
var path = require('path');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({
    imageMagick: true
});
var util = require('util');
var s3 = new AWS.S3();

function getFileNameNoExtension(filename){
    return filename.substr(0, filename.lastIndexOf('.'));
}

function notifySonicspan(fileName, context){
    var lambda = new AWS.Lambda({
        region: process.env.region
    });
    console.log('....notifying sonicspan from imgresize');
    var params = {
        FunctionName: process.env.functionName,
        Payload: JSON.stringify({"data": fileName})
    };
    lambda.invoke(params, function(error, data) {
        if (error) {
            console.log('Error on notifying... ' + error);
            context.done('error', error);
        }
        if(data.Payload){
            context.succeed(data.Payload)
        }
    });
}

exports.handler = function(event, context) {
    // Read options from the event.
    // console.log("Reading options from event:\n", util.inspect(event, {
    //     depth: 5
    // }));
    var srcBucket = event.Records[0].s3.bucket.name;
    var fileName;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(
        /\+/g, " "));
    var dstBucket = srcBucket;
    // Sanity check: validate that source and destination are different buckets.
    // if (srcBucket == dstBucket) {
    //     console.error("Destination bucket must not match source bucket.");
    //     return;
    //  }
    var large = {
        width: 1440,
        height:927,
        dstnKey: srcKey,
        destinationPath: "large"
    };
    var medium = {
        width:866.6,
        height:668,
        dstnKey: srcKey,
        destinationPath: "medium"
    };
    var small = {
        width: 474.6,
        height:320,
        dstnKey: srcKey,
        destinationPath: "small"
    };
    var thumbnail = {
        width: 98,
        height:98,
        dstnKey: srcKey,
        destinationPath: "thumbnail"
    };
    var _sizesArray = [large, medium, small, thumbnail];
    var len = _sizesArray.length;
    // console.log(len);
    // console.log(srcBucket);
    // console.log(srcKey);
    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    fileName = path.basename(srcKey);
    if (!typeMatch) {
        console.error('unable to infer image type for key ' + srcKey);
        return;
    }
    var imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "jpeg" && imageType != "gif" && imageType != "png" &&
        imageType != "eps" && imageType != "bmp" && imageType != "tiff") {
        console.log('skipping non-image ' + srcKey);
        return;
    }
    // Transform, and upload to same S3 bucket but to a different S3 bucket.
    async.forEachOf(_sizesArray, function(value, key, callback) {
        async.waterfall([

            function download(next) {
                //  console.time("downloadImage");
                //  console.log("download");
                // Download the image from S3 into a buffer.
                // sadly it downloads the image several times, but we couldn't place it outside
                // the variable was not recognized
                s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                }, next);
                //  console.timeEnd("downloadImage");
            },
            function convert(response, next) {
                // convert eps images to png
                // console.time("convertImage");
                //console.log("Reponse content type : " +
                // response.ContentType);
                // console.log("Conversion");
                gm(response.Body).antialias(true).density(
                    300).toBuffer('JPG', function(err,
                                                  buffer) {
                    if (err) {
                        //next(err);
                        next(err);
                    } else {
                        //  console.timeEnd(
                        //     "convertImage");
                        next(null, buffer);
                        //next(null, 'done');
                    }
                });
            },
            function process(response, next) {
                //   console.log("process image");
                //  console.time("processImage");
                // Transform the image buffer in memory.
                //gm(response.Body).size(function(err, size) {
                gm(response).autoOrient().size(function(err, size) {
                    var index, width, height, scalingFactor;
                    // Infer the scaling factor to avoid stretching the image unnaturally.
                    if(_sizesArray[key].destinationPath === 'thumbnail'){
                        if(size.width >= size.height){
                            height = _sizesArray[key].height;
                            width = null;
                        }
                        else{
                            width = _sizesArray[key].width;
                            height = null;
                        }
                    }
                    else{
                        scalingFactor = Math.min(
                            _sizesArray[key].width / size.width, _sizesArray[key].height / size.height, 1);

                        width = scalingFactor * size.width;
                        height = scalingFactor * size.height;
                    }
                    index = key;
                    //this.resize({width: width, height: height, format: 'jpg',})
                    this.resize(width, height).toBuffer(
                        'JPG', function(err,
                                        buffer) {
                            if (err) {
                                //next(err);
                                next(err);
                            } else {
                                //  console.timeEnd(
                                //      "processImage"
                                //  );
                                next(null,
                                    buffer,
                                    key);
                                //next(null, 'done');
                            }
                        });
                });
            },
            function upload(data, index, next) {
                // console.time("uploadImage");
                //  console.log("upload : " + index);
                //  console.log("upload to path : /images/" +
                //   _sizesArray[index].destinationPath +
                //   "/" + fileName.slice(0, -4) +
                //   ".jpg");
                // Stream the transformed image to a different folder.
                s3.putObject({
                    Bucket: dstBucket,
                    //Key: "images/" + _sizesArray[
                    //        index].destinationPath +
                    //    "/" + fileName.slice(0, -4) +
                    //    ".jpg",
                    Key: "transcodedimages/" + getFileNameNoExtension(fileName) + '_' +
                    _sizesArray[index].destinationPath + ".jpg",
                    Body: data,
                    ContentType: 'JPG'
                }, next);
                //  console.timeEnd("uploadImage");
            }
        ], function(err, result) {
            if (err) {
                console.error(err);
            }
            // result now equals 'done'
            console.log("End of step " + key);
            callback();
        });
    }, function(err) {
        if (err) {
            console.error('---->Unable to resize ' + srcBucket +
                '/' + srcKey + ' and upload to ' + dstBucket +
                '/images' + ' due to an error: ' + err);
        } else {
            console.log('---->Successfully resized ' + srcBucket +
                ' and uploaded to' + dstBucket + "/images");
        }
        /** Notify Sonicspan */
        notifySonicspan(fileName, context);
    });
};