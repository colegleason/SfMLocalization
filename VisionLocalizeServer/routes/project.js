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
 * POST points to proejct back to a camera's view
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
exports.project = function(req, res) {
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
    if (!req.body.points) {
    	console.log('Error : Points not specified');
        return sendErrorResponse(404, 'Points not specified');
    }
    if (!req.files || !req.files.image) {
    	console.log('Error : Image data is not specified');
        return sendErrorResponse(404, "Image data is not specified");
    }

    // check points parameter
    if (!Array.isArray(req.body.points) || req.body.bounding.length <= 0) {
    	console.log('Error : Points not specified');
        return sendErrorResponse(404, 'Points not specified');
    }
    var pointsError = false;
    var points = req.body.points.map(function(p) {
        if (typeof p == "string") {
            p = JSON.parse(p);
        }
        if (!Array.isArray(p) || p.length != 3) {
            pointsError = true;
        }
        return p.map(function(n) {
            return parseFloat(n);
        });
    });

    if (pointsError) {
    	console.log('Error : Points have incorrect format');
        return sendErrorResponse(404, 'Points have incorrect format');
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

    async.waterfall([
        function(callback) {
            fs.readFile(req.files.image.path, function (err, data) {
                var imageName = req.files.image.name;
                if(!imageName){
                    console.log("Error to load uploaded image");
                    res.redirect("/");
                    res.end();
                    return callback(new Error("Error to load uploaded image"), null);
                } else {
                    return callback(err, data);
                }
            });
        },
        function(image, callback) {
            var estimate = localizeImage.localizeImageBufferBeacon(
                req.query.user, kMatFile, distMatFile, scaleImage,
	        req.query.map, sfmDataDir, matchDir, aMatFile, image, req.query.beacon
            );
            if (!estimate || estimate.length == 0) {
                return callback(new Error("could not localize"), null);
            } else {
                var t = estimate.slice(0,3);
                var R = [result.slice(3,6),result.slice(6,9),result.slice(9,12)];
                return callback(null, R, t);
            }
        },
        function(R, t, callback) {
            var result = localizeImage.project3Dto2D(kMatFile, distMatFile, R, t, points);
            console.log(result)l
            var jsonObj = {'imagePoints':result};
            // Send back the result as a JSON
            return callback(null, JSON.stringify(jsonObj));
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
