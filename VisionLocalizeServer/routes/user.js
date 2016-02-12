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
 * GET users listing.
 */

var share = require('../lib/share');

exports.list = function(req, res){  
  res.writeHead(200, {
	  'Access-Control-Allow-Origin': '*',
	  'Content-Type': 'application/json'
  });
  var json = JSON.stringify({ 
    users: Object.keys(share.userHistories)
  });
  res.end(json);  
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
	if (!share.userHistories[req.query.name]) {
		console.log('Error : User ID is not valid');
		return sendErrorResponse(500, 'User ID is not valid');
	}
	
	res.writeHead(200, {
		'Access-Control-Allow-Origin': '*',
		'Content-Type': 'application/json'
	});
	var json = JSON.stringify({ 
		history: share.userHistories[req.query.name]
	});
	res.end(json);
};