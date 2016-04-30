/*******************************************************************************
* Copyright (c) 2015 IBM Corporation
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*******************************************************************************/

/*
 * POST image to get 3D location of objects in bounding boxes
 */

var validator = require('validator'), async = require('async'), request = require('request'), fs = require('fs'),
	localizeImage = require('bindings')('localizeImage'), share = require('../lib/share');

var MAX_USER_HISTORY_LENGTH = 10;

/*
 * POST parameters
 *  user : ID of user
 * 	map : ID of map
 *  image : binary image data
 *  bounding: list of points to create bounding boxes on the image.
 *    should be x1_top,y1_top,x1_bottom,y1_bottom,x2_top,y2_top .,
 *  cx : center to restrict localization area (optional)
 *  cy : center to restrict localization area (optional)
 *  cz : center to restrict localization area (optional)
 *  radius : center to restrict localization area (optional)
 *  beacon : iBeacon signal for query image (optional)
 */
exports.estimatePost = function(req, res) {
    var sendErrorResponse = function(code, message) {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json");
        res.write(JSON.stringify({
            message : message
        }));
        res.end();
    };
    if (!req.body.user) {
    	console.log('Error : User ID is not specified');
        return sendErrorResponse(404, 'User ID is not specified');
    }
    if (!req.body.map) {
    	console.log('Error : Map ID is not specified');
        return sendErrorResponse(404, 'Map ID is not specified');
    }
    if (!req.body.bounding) {
    	console.log('Error : Bounding boxes not specified');
        return sendErrorResponse(404, 'Bouding boxes not specified');
    }
    if (!req.files || !req.files.image) {
    	console.log('Error : Image data is not specified');
        return sendErrorResponse(404, "Image data is not specified");
    }

    // check bounding parameter
    if (!Array.isArray(req.body.bounding) || req.body.bounding.length <= 0) {
    	console.log('Error : Bounding boxes not specified');
        return sendErrorResponse(404, 'Bouding boxes not specified');
    }
    var boundingBoxError = false;
    var boundingBoxes = [];
    req.body.bounding.forEach(function(boundingBox) {
        if (typeof boundingBox == "string") {
            boundingBox = JSON.parse(boundingBox);
        }
        if (!Array.isArray(boundingBox) || boundingBox.length != 4) {
            boundingBoxError = true;
        }
        boundingBoxes = boundingBoxes.concat(boundingBox);
    });

    if (boundingBoxError) {
    	console.log('Error : Bounding boxes have incorrect format');
        return sendErrorResponse(404, 'Bouding boxes have incorrect format');
    }
    boundingBoxes = boundingBoxes.map(function(n) {
        return parseInt(n, 10);
    });
    if (Math.min(boundingBoxes) < 0) {
        console.log('Error : Bounding points cannot be negative');
        return sendErrorResponse(404, 'Bouding boxes points cannot be negative');
    }
    // check user parameter
    if (!share.userNameMap[req.body.user]) {
    	console.log('Error : User ID is not valid');
    	return sendErrorResponse(500, 'User ID is not valid');
    }
    var kMatFile = share.userNameMap[req.body.user]['k_mat_file'];
    var distMatFile = share.userNameMap[req.body.user]['dist_mat_file'];

    // check map parameter
    if (!share.mapNameMap[req.body.map]) {
    	console.log('Error : Map ID is not valid');
    	return sendErrorResponse(500, 'Map ID is not valid');
    }
    var sfmDataDir = share.mapNameMap[req.body.map]['sfm_data_dir'];
    var matchDir = share.mapNameMap[req.body.map]['match_dir'];
    var aMatFile = share.mapNameMap[req.body.map]['a_mat_file'];
    var scaleImage = share.userNameMap[req.body.user]['scale_image'];

    async.waterfall([ function(callback) {
        fs.readFile(req.files.image.path, function (err, data) {
            var imageName = req.files.image.name;
            if(!imageName){
                console.log("Error to load uploaded image");
                res.redirect("/");
                res.end();
            } else {
                var result;
                result = localizeImage.getBoundedFeatures(req.body.user, kMatFile, distMatFile, scaleImage,
                                                          req.body.map, sfmDataDir, matchDir, aMatFile, data, boundingBoxes);
            }
            var jsonObj;
            if (result && result.length>0) {
                jsonObj = {'boundingBoxResults':[]};
                var boundingBoxPointNums = result.splice(0, req.body.bounding.length);
                boundingBoxPointNums.forEach(function (n) {
                    var points = result.splice(0, n*3);
                    var reshapedPoints = [];
                    for (var i =0; i < points.length; i = i + 3) {
                        reshapedPoints.push(
                            {x: points[i], y: points[i+1], z: points[i+2]}
                        );
                    }
                    jsonObj['boundingBoxResults'].push(reshapedPoints);
                });
                // update users' history
                if (!share.boundingHistories[req.body.user]) {
                    share.boundingHistories[req.body.user] = [];
                }
                if (share.boundingHistories[req.body.user].length>MAX_USER_HISTORY_LENGTH) {
                    share.boundingHistories[req.body.user].shift();
                }
                share.boundingHistories[req.body.user].push(jsonObj);
            } else {
                jsonObj = [];
            }
            // Send back the result as a JSON
            callback(null, JSON.stringify(jsonObj));
        });
    }], function(err, result) {
        if (err) {
            sendErrorResponse(500, err.message);
        }
        res.setHeader("Content-Type", "application/json");
        res.header("Access-Control-Allow-Origin", "*");
        res.write(result);
        res.end();
    });
};


exports.history = function(req, res){
    var sendErrorResponse = function(code, message) {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json");
        res.write(JSON.stringify({
            message : message
        }));
        res.end();
    };
    if (!req.query.name) {
    	console.log('Error : User ID is not specified');
    	return sendErrorResponse(404, 'User ID is not specified');
    }
    if (!share.boundingHistories[req.query.name]) {
	console.log('Error : User ID is not valid');
	return sendErrorResponse(500, 'User ID is not valid');
    }
    res.writeHead(200, {
	'Access-Control-Allow-Origin': '*',
	'Content-Type': 'application/json'
    });
    var json = JSON.stringify({
	history: share.boundingHistories[req.query.name]
    });
    res.end(json);
};
