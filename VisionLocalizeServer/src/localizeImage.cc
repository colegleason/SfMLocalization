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

#include <node.h>
#include <node_buffer.h>
#include <v8.h>
#include <uuid/uuid.h>
#include <stdlib.h>

#include <opencv2/opencv.hpp>
#include <sfm/sfm_data.hpp>
#include <sfm/sfm_data_io.hpp>
#include <openMVG/sfm/pipelines/sfm_robust_model_estimation.hpp>
#include <openMVG/sfm/pipelines/sfm_matches_provider.hpp>

#include "LocalizeEngine.h"

using namespace std;
using namespace v8;

std::map<std::string, std::map<std::string, LocalizeEngine> > sfmDataDirMap;
std::map<std::string, std::map<std::string, LocalizeEngine> > matchDirMap;
std::map<std::string, std::map<std::string, LocalizeEngine> > aMatFileMap;

static const double SECOND_TEST_RATIO = 0.6;
static const int RANSAC_ROUND = 25;
static const double RANSAC_PRECISION = 4.0;
static const bool GUIDED_MATCHING = false;
static const int BEACON_KNN_NUM = 400; // set 0 if you do not want to use BOW
// setting for version 0.2
//static const int BOW_KNN_NUM = 200; // set 0 if you do not want to use BOW
// modified 2016.02.16
static const int BOW_KNN_NUM = 20; // set 0 if you do not want to use BOW

static const std::string TMP_DIR = "/tmp/vision-localize-server";

std::map<std::string, std::map<std::string, LocalizeEngine> > localizeEngineMap;
std::map<std::string, cv::Mat> userMapxMap;
std::map<std::string, cv::Mat> userMapyMap;
std::map<std::string, cv::Mat> userCameraMatMap;
std::map<std::string, cv::Mat> userDistMap;
std::map<std::string, cv::Mat> userNewCameraMatMap;
std::map<std::string, cv::Rect> userValidRoiMap;

/*
 * Caution : This function caches SfM data in memory to improve performance.
 * 			 You cannot call this function at the same time with same User ID and Map ID.
 */
Local<Array> execLocalizeImage(const std::string& userID, const std::string& kMatFile, const std::string& distMatFile,
                               const std::string& mapID, const std::string& sfmDataDir, const std::string& matchDir, const std::string& aMatFile,
                               double scaleImage, const cv::Mat& _image, const std::string& beaconStr,
                               const std::vector<double>& center=std::vector<double>(), double radius=-1.0) {
    // scale input image if option is set
    cv::Mat image;

    if (scaleImage==1.0) {
        image = _image;
    } else {
        cv::resize(_image, image, cv::Size(), scaleImage, scaleImage);
    }

    // select localize engine
    LocalizeEngine localizeEngine;
    if (localizeEngineMap.find(userID) != localizeEngineMap.end()
        && localizeEngineMap[userID].find(mapID) != localizeEngineMap[userID].end()) {
        localizeEngine = localizeEngineMap[userID][mapID];
    } else {
        cout << "load new localize engine, userID : " << userID << ", mapID : " << mapID << endl;
        localizeEngine = LocalizeEngine(sfmDataDir, matchDir, aMatFile, SECOND_TEST_RATIO,
                                        RANSAC_ROUND, RANSAC_PRECISION, GUIDED_MATCHING, BEACON_KNN_NUM, BOW_KNN_NUM);
    }

    // create unique task ID for creating work directory
    string localizeTaskID;
    {
        uuid_t uuidValue;
        uuid_generate(uuidValue);
        char uuidChar[36];
        uuid_unparse_upper(uuidValue, uuidChar);
        localizeTaskID = string(uuidChar);
    }

    // create working directory
    if (!stlplus::folder_exists(TMP_DIR)) {
        stlplus::folder_create(TMP_DIR);
        cout << "working directory does not exits, created folder : " << TMP_DIR << endl;
    }
    string workingDir = stlplus::create_filespec(TMP_DIR, localizeTaskID);
    if (stlplus::folder_create(workingDir)) {
        cout << "successed to create working folder : " << workingDir << endl;
    } else {
        cout << "failed to create working folder : " << workingDir << endl;
        return Array::New(0);
    }

    cv::Mat mapx, mapy, intrinsicK, intrinsicDist, newCameraMat;
    cv::Rect validRoi;
    if (userMapxMap.find(userID)==userMapxMap.end() || userMapyMap.find(userID)==userMapyMap.end()
        || userCameraMatMap.find(userID)==userCameraMatMap.end() || userDistMap.find(userID)==userDistMap.end()
        || userNewCameraMatMap.find(userID)==userNewCameraMatMap.end() || userValidRoiMap.find(userID)==userValidRoiMap.end()) {
        {
            cv::FileStorage storage(kMatFile, cv::FileStorage::READ);
            storage["K"] >> intrinsicK;
            storage.release();
        }
        {
            cv::FileStorage storage(distMatFile, cv::FileStorage::READ);
            storage["dist"] >> intrinsicDist;
            storage.release();
        }


        cv::Size imageSize = cv::Size(image.cols, image.rows);



        cout << "debug 0 " << scaleImage << endl;
        cout << "intrinsicK" << intrinsicK << endl;
        cout << "intrinsicDist" << intrinsicDist << endl;
        cout << "imageSize" << imageSize << endl;

        newCameraMat = cv::getOptimalNewCameraMatrix(intrinsicK, intrinsicDist, imageSize,
                                                     1.0, imageSize, &validRoi);
        cout << "debug 1 " << scaleImage << endl;

        cv::initUndistortRectifyMap(intrinsicK, intrinsicDist, cv::Mat(),
                                    newCameraMat, imageSize, CV_16SC2, mapx, mapy);

        userMapxMap[userID] = mapx;
        userMapyMap[userID] = mapy;
        userCameraMatMap[userID] = intrinsicK;
        userDistMap[userID] = intrinsicDist;
        userNewCameraMatMap[userID] = newCameraMat;
        userValidRoiMap[userID] = validRoi;
    } else {
        mapx = userMapxMap[userID];
        mapy = userMapyMap[userID];
        intrinsicK = userCameraMatMap[userID];
        intrinsicDist = userDistMap[userID];
        newCameraMat = userNewCameraMatMap[userID];
        validRoi = userValidRoiMap[userID];
    }

    cv::Mat undistortImage;

    // faster version
    //cv::remap(image, undistortImage, mapx, mapy, cv::INTER_LINEAR);
    // slower version
    cv::undistort(image, undistortImage, intrinsicK, intrinsicDist, newCameraMat);

    undistortImage = undistortImage(validRoi).clone();

    // execute localize
    vector<double> pos = localizeEngine.localize(undistortImage, workingDir, beaconStr, center, radius);

    // update localize engine map
    localizeEngineMap[userID][mapID] = localizeEngine;

    // remove working directory
    if (stlplus::folder_delete(workingDir, true)) {
        cout << "successed to delete working folder : " << workingDir << endl;
    } else {
        cout << "failed to delete working folder : " << workingDir << endl;
    }

    // return result
    if (pos.size()==12) {
        Local<Array> result = Array::New(12);
        for (int i=0; i<12; i++) {
            result->Set(Number::New(i), Number::New(pos[i]));
        }

        return result;
    } else {
        return Array::New(0);
    }
}

Handle<Value> LocalizeImageBuffer(const Arguments& args) {
    HandleScope scope;

    if (args.Length() != 9 && args.Length() != 11) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsString()
        || !args[3]->IsNumber() || !args[4]->IsString() || !args[5]->IsString()
        || !args[6]->IsString() || !args[7]->IsString() || !args[8]->IsObject()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    Local<String> userID = args[0]->ToString();
    char userIDChar[userID->Length()];
    userID->WriteUtf8(userIDChar);

    Local<String> kMatFile = args[1]->ToString();
    char kMatFileChar[kMatFile->Length()];
    kMatFile->WriteUtf8(kMatFileChar);

    Local<String> distMatFile = args[2]->ToString();
    char distMatFileChar[distMatFile->Length()];
    distMatFile->WriteUtf8(distMatFileChar);

    double scaleImage = args[3]->NumberValue();

    Local<String> mapID = args[4]->ToString();
    char mapIDChar[mapID->Length()];
    mapID->WriteUtf8(mapIDChar);

    Local<String> sfmDataDir = args[5]->ToString();
    char sfmDataDirChar[sfmDataDir->Length()];
    sfmDataDir->WriteUtf8(sfmDataDirChar);

    Local<String> matchDir = args[6]->ToString();
    char matchDirChar[matchDir->Length()];
    matchDir->WriteUtf8(matchDirChar);

    Local<String> aMatFile = args[7]->ToString();
    char aMatFileChar[aMatFile->Length()];
    aMatFile->WriteUtf8(aMatFileChar);

    Local<Object> imageBuffer = args[8]->ToObject();
    char* imageData    = node::Buffer::Data(imageBuffer);
    size_t imageDataLen = node::Buffer::Length(imageBuffer);
    cv::Mat image = cv::imdecode(cv::_InputArray(imageData, imageDataLen), cv::IMREAD_COLOR);
    if (image.empty() || image.rows==0 || image.cols==0) {
        ThrowException(Exception::TypeError(String::New("Input image is empty")));
        return scope.Close(Undefined());
    }

    Local<Array> result;
    if (args.Length()==9) {
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, "");
    } else {
        Local<Array> center = Array::Cast(*args[9]);
        std::vector<double> centerVec;
        for(unsigned int i = 0; i < center->Length(); i++) {
            centerVec.push_back(center->Get(i)->NumberValue());
        }
        double radius = args[10]->NumberValue();
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, "", centerVec, radius);
    }
    return scope.Close(result);
}

Handle<Value> LocalizeImagePath(const Arguments& args) {
    HandleScope scope;

    if (args.Length() != 9 && args.Length() != 11) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsString()
        || !args[3]->IsNumber() || !args[4]->IsString() || !args[5]->IsString()
        || !args[6]->IsString() || !args[7]->IsString() || !args[8]->IsString()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    Local<String> userID = args[0]->ToString();
    char userIDChar[userID->Length()];
    userID->WriteUtf8(userIDChar);

    Local<String> kMatFile = args[1]->ToString();
    char kMatFileChar[kMatFile->Length()];
    kMatFile->WriteUtf8(kMatFileChar);

    Local<String> distMatFile = args[2]->ToString();
    char distMatFileChar[distMatFile->Length()];
    distMatFile->WriteUtf8(distMatFileChar);

    double scaleImage = args[3]->NumberValue();

    Local<String> mapID = args[4]->ToString();
    char mapIDChar[mapID->Length()];
    mapID->WriteUtf8(mapIDChar);

    Local<String> sfmDataDir = args[5]->ToString();
    char sfmDataDirChar[sfmDataDir->Length()];
    sfmDataDir->WriteUtf8(sfmDataDirChar);

    Local<String> matchDir = args[6]->ToString();
    char matchDirChar[matchDir->Length()];
    matchDir->WriteUtf8(matchDirChar);

    Local<String> aMatFile = args[7]->ToString();
    char aMatFileChar[aMatFile->Length()];
    aMatFile->WriteUtf8(aMatFileChar);

    Local<String> imagePath = args[8]->ToString();
    char imagePathChar[imagePath->Length()];
    imagePath->WriteUtf8(imagePathChar);
    cv::Mat image = cv::imread(std::string(imagePathChar), cv::IMREAD_COLOR);
    if (image.empty() || image.rows==0 || image.cols==0) {
        ThrowException(Exception::TypeError(String::New("Input image is empty")));
        return scope.Close(Undefined());
    }

    Local<Array> result;
    if (args.Length() == 9) {
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, "");
    } else {
        Local<Array> center = Array::Cast(*args[9]);
        std::vector<double> centerVec;
        for(unsigned int i = 0; i < center->Length(); i++) {
            centerVec.push_back(center->Get(i)->NumberValue());
        }
        double radius = args[10]->NumberValue();
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, "", centerVec, radius);
    }
    return scope.Close(result);
}

Handle<Value> LocalizeImageBufferBeacon(const Arguments& args) {
    HandleScope scope;

    if (args.Length() != 10 && args.Length() != 12) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsString()
        || !args[3]->IsNumber() || !args[4]->IsString() || !args[5]->IsString()
        || !args[6]->IsString() || !args[7]->IsString() || !args[8]->IsObject()
        || !args[9]->IsString()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    Local<String> userID = args[0]->ToString();
    char userIDChar[userID->Length()];
    userID->WriteUtf8(userIDChar);

    Local<String> kMatFile = args[1]->ToString();
    char kMatFileChar[kMatFile->Length()];
    kMatFile->WriteUtf8(kMatFileChar);

    Local<String> distMatFile = args[2]->ToString();
    char distMatFileChar[distMatFile->Length()];
    distMatFile->WriteUtf8(distMatFileChar);

    double scaleImage = args[3]->NumberValue();

    Local<String> mapID = args[4]->ToString();
    char mapIDChar[mapID->Length()];
    mapID->WriteUtf8(mapIDChar);

    Local<String> sfmDataDir = args[5]->ToString();
    char sfmDataDirChar[sfmDataDir->Length()];
    sfmDataDir->WriteUtf8(sfmDataDirChar);

    Local<String> matchDir = args[6]->ToString();
    char matchDirChar[matchDir->Length()];
    matchDir->WriteUtf8(matchDirChar);

    Local<String> aMatFile = args[7]->ToString();
    char aMatFileChar[aMatFile->Length()];
    aMatFile->WriteUtf8(aMatFileChar);

    Local<Object> imageBuffer = args[8]->ToObject();
    char* imageData    = node::Buffer::Data(imageBuffer);
    size_t imageDataLen = node::Buffer::Length(imageBuffer);
    cv::Mat image = cv::imdecode(cv::_InputArray(imageData, imageDataLen), cv::IMREAD_COLOR);
    if (image.empty() || image.rows==0 || image.cols==0) {
        ThrowException(Exception::TypeError(String::New("Input image is empty")));
        return scope.Close(Undefined());
    }

    Local<String> beaconStr = args[9]->ToString();
    char beaconStrChar[beaconStr->Length()];
    beaconStr->WriteUtf8(beaconStrChar);

    Local<Array> result;
    if (args.Length()==10) {
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, std::string(beaconStrChar));
    } else {
        Local<Array> center = Array::Cast(*args[9]);
        std::vector<double> centerVec;
        for(unsigned int i = 0; i < center->Length(); i++) {
            centerVec.push_back(center->Get(i)->NumberValue());
        }
        double radius = args[10]->NumberValue();
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, std::string(beaconStrChar), centerVec, radius);
    }
    return scope.Close(result);
}

Handle<Value> LocalizeImagePathBeacon(const Arguments& args) {
    HandleScope scope;

    if (args.Length() != 10 && args.Length() != 12) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsString()
        || !args[3]->IsNumber() || !args[4]->IsString() || !args[5]->IsString()
        || !args[6]->IsString() || !args[7]->IsString() || !args[8]->IsString()
        || !args[9]->IsString()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    Local<String> userID = args[0]->ToString();
    char userIDChar[userID->Length()];
    userID->WriteUtf8(userIDChar);

    Local<String> kMatFile = args[1]->ToString();
    char kMatFileChar[kMatFile->Length()];
    kMatFile->WriteUtf8(kMatFileChar);

    Local<String> distMatFile = args[2]->ToString();
    char distMatFileChar[distMatFile->Length()];
    distMatFile->WriteUtf8(distMatFileChar);

    double scaleImage = args[3]->NumberValue();

    Local<String> mapID = args[4]->ToString();
    char mapIDChar[mapID->Length()];
    mapID->WriteUtf8(mapIDChar);

    Local<String> sfmDataDir = args[5]->ToString();
    char sfmDataDirChar[sfmDataDir->Length()];
    sfmDataDir->WriteUtf8(sfmDataDirChar);

    Local<String> matchDir = args[6]->ToString();
    char matchDirChar[matchDir->Length()];
    matchDir->WriteUtf8(matchDirChar);

    Local<String> aMatFile = args[7]->ToString();
    char aMatFileChar[aMatFile->Length()];
    aMatFile->WriteUtf8(aMatFileChar);

    Local<String> imagePath = args[8]->ToString();
    char imagePathChar[imagePath->Length()];
    imagePath->WriteUtf8(imagePathChar);
    cv::Mat image = cv::imread(std::string(imagePathChar), cv::IMREAD_COLOR);
    if (image.empty() || image.rows==0 || image.cols==0) {
        ThrowException(Exception::TypeError(String::New("Input image is empty")));
        return scope.Close(Undefined());
    }

    Local<String> beaconStr = args[9]->ToString();
    char beaconStrChar[beaconStr->Length()];
    beaconStr->WriteUtf8(beaconStrChar);

    Local<Array> result;
    if (args.Length() == 10) {
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, std::string(beaconStrChar));
    } else {
        Local<Array> center = Array::Cast(*args[10]);
        std::vector<double> centerVec;
        for(unsigned int i = 0; i < center->Length(); i++) {
            centerVec.push_back(center->Get(i)->NumberValue());
        }
        double radius = args[11]->NumberValue();
        result = execLocalizeImage(std::string(userIDChar), std::string(kMatFileChar), std::string(distMatFileChar),
                                   std::string(mapIDChar), std::string(sfmDataDirChar), std::string(matchDirChar), std::string(aMatFileChar),
                                   scaleImage, image, std::string(beaconStrChar), centerVec, radius);
    }
    return scope.Close(result);
}

Handle<Value> project3Dto2D(const Arguments& args) {
    HandleScope scope;
    cout <<"project3Dto2D" << endl;
    if (args.Length() != 5) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsArray() ||
        !args[3]->IsArray() || !args[4]->IsArray()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    cv::Mat cameraMatrix, distCoeffs;
    Local<String> kMatFile = args[0]->ToString();
    char kMatFileChar[kMatFile->Length()];
    kMatFile->WriteUtf8(kMatFileChar);
    {
        cv::FileStorage storage(std::string(kMatFileChar), cv::FileStorage::READ);
        storage["K"] >> cameraMatrix;
        cout << "cameraMatrix = " << cameraMatrix << endl;
        storage.release();
    }

    Local<String> distMatFile = args[1]->ToString();
    char distMatFileChar[distMatFile->Length()];
    distMatFile->WriteUtf8(distMatFileChar);
    {
        cv::FileStorage storage(std::string(distMatFileChar), cv::FileStorage::READ);
        storage["dist"] >> distCoeffs;
        cout << "distCoeffs = " << distCoeffs << endl;
        storage.release();
    }

    cv::Mat R = cv::Mat::zeros(3, 3, CV_64F);
    Local<Array> Rarray = Local<Array>::Cast(args[2]);
    for (unsigned int i = 0; i < Rarray->Length(); i++) {
        Local<Array> row = Local<Array>::Cast(Rarray->Get(i));
        for (unsigned int j = 0; j < row->Length(); j++) {
            double n = row->Get(j)->NumberValue();
            R.at<double>(i,j) = n;
        }
    }

    // convert Rotation matrix from 3x3 to 3x1 vector
    cv::Mat rvec = cv::Mat::zeros(1,3,CV_64F);
    cv::Rodrigues(R, rvec);

    cv::Mat tvec = cv::Mat::zeros(1,3,CV_64F);
    Local<Array> tarray = Local<Array>::Cast(args[3]);
    for (unsigned int i = 0; i < tarray->Length(); i++) {
        double n = tarray->Get(i)->NumberValue();
        tvec.at<double>(0,i) = n;
    }

    Local<Array> pointsArray = Local<Array>::Cast(args[4]);
    vector<cv::Vec3f> points;
    for (unsigned int i = 0; i < pointsArray->Length(); i++) {
        Local<Array> point = Local<Array>::Cast(pointsArray->Get(i));
        float x = point->Get(0)->NumberValue(),
            y = point->Get(1)->NumberValue(),
            z = point->Get(2)->NumberValue();
        cv::Vec3f p = cv::Vec3f{x,y,z};
        points.push_back(p);
    }

    // project points to image
    vector<cv::Vec2f> imagePoints;
    cv::projectPoints(points, rvec, tvec, cameraMatrix, distCoeffs, imagePoints);

    // create Node 2-dim array for result
    Handle<Array> result = Array::New(imagePoints.size());
    for(unsigned int i = 0; i < imagePoints.size(); i++) {
        Handle<Array> item = Array::New(2);
        Local<Value> x = Number::New(imagePoints[i][0]);
        Local<Value> y = Number::New(imagePoints[i][1]);
        item->Set(0, x);
        item->Set(1, y);
        result->Set(i, item);
    }
    return scope.Close(result);
}

Handle<Value> getBoundedFeatures(const Arguments& args) {
    HandleScope scope;
    if (args.Length() != 10) {
        ThrowException(
                       Exception::TypeError(String::New("Wrong number of arguments")));
        return scope.Close(Undefined());
    }
    if (!args[0]->IsString() || !args[1]->IsString() || !args[2]->IsString()
        || !args[3]->IsNumber() || !args[4]->IsString() || !args[5]->IsString()
        || !args[6]->IsString() || !args[7]->IsString() || !args[8]->IsObject()
        || !args[9]->IsArray()) {
        ThrowException(Exception::TypeError(String::New("Wrong arguments")));
        return scope.Close(Undefined());
    }

    String::Utf8Value arg0(args[0]->ToString());
    std::string userID = std::string(*arg0);

    String::Utf8Value arg1(args[1]->ToString());
    std::string kMatFile = std::string(*arg1);

    String::Utf8Value arg2(args[2]->ToString());
    std::string distMatFile = std::string(*arg2);

    double scaleImage = args[3]->NumberValue();

    String::Utf8Value arg4(args[4]->ToString());
    std::string mapID = std::string(*arg4);

    String::Utf8Value arg5(args[5]->ToString());
    std::string sfmDataDir = std::string(*arg5);

    String::Utf8Value arg6(args[6]->ToString());
    std::string matchDir = std::string(*arg6);

    String::Utf8Value arg7(args[7]->ToString());
    std::string aMatFile = std::string(*arg7);

    Local<Object> imageBuffer = args[8]->ToObject();
    char* imageData    = node::Buffer::Data(imageBuffer);
    size_t imageDataLen = node::Buffer::Length(imageBuffer);
    cv::Mat _image = cv::imdecode(cv::_InputArray(imageData, imageDataLen), cv::IMREAD_COLOR);
    if (_image.empty() || _image.rows==0 || _image.cols==0) {
        ThrowException(Exception::TypeError(String::New("Input image is empty")));
        return scope.Close(Undefined());
    }

    Local<Array> bbInput = Local<Array>::Cast(args[9]);
    vector<BoundingBox> boundingBoxes;
    for (unsigned int i=0; i < bbInput->Length(); i = i+4) {
        double x1 = bbInput->Get(i)->NumberValue(),
            y1 = bbInput->Get(i+1)->NumberValue(),
            x2 = bbInput->Get(i+2)->NumberValue(),
            y2 = bbInput->Get(i+3)->NumberValue();
        boundingBoxes.push_back(pair<openMVG::Vec2,openMVG::Vec2>(openMVG::Vec2{x1, y1}, openMVG::Vec2{x2, y2}));
    }

    // scale input image if option is set
    cv::Mat image;

    if (scaleImage==1.0) {
        image = _image;
    } else {
        cv::resize(_image, image, cv::Size(), scaleImage, scaleImage);
    }

    // select localize engine
    LocalizeEngine localizeEngine;
    if (localizeEngineMap.find(userID) != localizeEngineMap.end()
        && localizeEngineMap[userID].find(mapID) != localizeEngineMap[userID].end()) {
        localizeEngine = localizeEngineMap[userID][mapID];
    } else {
        cout << "load new localize engine, userID : " << userID << ", mapID : " << mapID << endl;
        localizeEngine = LocalizeEngine(sfmDataDir, matchDir, aMatFile, SECOND_TEST_RATIO,
                                        RANSAC_ROUND, RANSAC_PRECISION, GUIDED_MATCHING, BEACON_KNN_NUM, BOW_KNN_NUM);
    }

    // create unique task ID for creating work directory
    string localizeTaskID;
    {
        uuid_t uuidValue;
        uuid_generate(uuidValue);
        char uuidChar[36];
        uuid_unparse_upper(uuidValue, uuidChar);
        localizeTaskID = string(uuidChar);
    }

    // create working directory
    if (!stlplus::folder_exists(TMP_DIR)) {
        stlplus::folder_create(TMP_DIR);
        cout << "working directory does not exits, created folder : " << TMP_DIR << endl;
    }
    string workingDir = stlplus::create_filespec(TMP_DIR, localizeTaskID);
    if (stlplus::folder_create(workingDir)) {
        cout << "successed to create working folder : " << workingDir << endl;
    } else {
        cout << "failed to create working folder : " << workingDir << endl;
        return Array::New(0);
    }

    cv::Mat mapx, mapy, intrinsicK, intrinsicDist, newCameraMat;
    cv::Rect validRoi;
    if (userMapxMap.find(userID)==userMapxMap.end() || userMapyMap.find(userID)==userMapyMap.end()
        || userCameraMatMap.find(userID)==userCameraMatMap.end() || userDistMap.find(userID)==userDistMap.end()
        || userNewCameraMatMap.find(userID)==userNewCameraMatMap.end() || userValidRoiMap.find(userID)==userValidRoiMap.end()) {
        {
            cv::FileStorage storage(kMatFile, cv::FileStorage::READ);
            storage["K"] >> intrinsicK;
            storage.release();
        }
        {
            cv::FileStorage storage(distMatFile, cv::FileStorage::READ);
            storage["dist"] >> intrinsicDist;
            storage.release();
        }

        cv::Size imageSize = cv::Size(image.cols, image.rows);

        cout << "debug 0 " << scaleImage << endl;
        cout << "intrinsicK" << intrinsicK << endl;
        cout << "intrinsicDist" << intrinsicDist << endl;
        cout << "imageSize" << imageSize << endl;

        newCameraMat = cv::getOptimalNewCameraMatrix(intrinsicK, intrinsicDist, imageSize,
                                                     1.0, imageSize, &validRoi);
        cout << "debug 1 " << scaleImage << endl;

        cv::initUndistortRectifyMap(intrinsicK, intrinsicDist, cv::Mat(),
                                    newCameraMat, imageSize, CV_16SC2, mapx, mapy);

        userMapxMap[userID] = mapx;
        userMapyMap[userID] = mapy;
        userCameraMatMap[userID] = intrinsicK;
        userDistMap[userID] = intrinsicDist;
        userNewCameraMatMap[userID] = newCameraMat;
        userValidRoiMap[userID] = validRoi;
    } else {
        mapx = userMapxMap[userID];
        mapy = userMapyMap[userID];
        intrinsicK = userCameraMatMap[userID];
        intrinsicDist = userDistMap[userID];
        newCameraMat = userNewCameraMatMap[userID];
        validRoi = userValidRoiMap[userID];
    }

    cv::Mat undistortImage;

    // faster version
    //cv::remap(image, undistortImage, mapx, mapy, cv::INTER_LINEAR);
    // slower version
    cv::undistort(image, undistortImage, intrinsicK, intrinsicDist, newCameraMat);

    undistortImage = undistortImage(validRoi).clone();

    // execute getting the bounding boxes
    BoundingBoxResult pos = localizeEngine.getBoundedFeatures(undistortImage, workingDir, boundingBoxes);

    // update localize engine map
    localizeEngineMap[userID][mapID] = localizeEngine;

    // remove working directory
    if (stlplus::folder_delete(workingDir, true)) {
        cout << "successed to delete working folder : " << workingDir << endl;
    } else {
        cout << "failed to delete working folder : " << workingDir << endl;
    }

    int nElem = pos.size();
    for (unsigned int i = 0; i < pos.size(); i++) {
        nElem = nElem + (pos[i].size() * 3);
    }
    // return result
    Local<Array> result = Array::New(nElem);
    int c = 0;
    // set number of points per bounding box
    for (unsigned int i=0; i < pos.size(); i++) {
        result->Set(Number::New(c++), Number::New(pos[i].size()));
    }
    for (unsigned int i=0; i < pos.size(); i++) {
        for (unsigned int j=0; j < pos[i].size(); j++) {
            result->Set(Number::New(c++), Number::New(pos[i][j](0)));
            result->Set(Number::New(c++), Number::New(pos[i][j](1)));
            result->Set(Number::New(c++), Number::New(pos[i][j](2)));
        }
    }
    return scope.Close(result);
}

void Init(Handle<Object> exports) {
    exports->Set(String::NewSymbol("localizeImageBuffer"),
                 FunctionTemplate::New(LocalizeImageBuffer)->GetFunction());
    exports->Set(String::NewSymbol("localizeImagePath"),
                 FunctionTemplate::New(LocalizeImagePath)->GetFunction());
    exports->Set(String::NewSymbol("localizeImageBufferBeacon"),
                 FunctionTemplate::New(LocalizeImageBufferBeacon)->GetFunction());
    exports->Set(String::NewSymbol("localizeImagePathBeacon"),
                 FunctionTemplate::New(LocalizeImagePathBeacon)->GetFunction());
    exports->Set(String::NewSymbol("getBoundedFeatures"),
                 FunctionTemplate::New(getBoundedFeatures)->GetFunction());
    exports->Set(String::NewSymbol("project3Dto2D"),
                 FunctionTemplate::New(project3Dto2D)->GetFunction());
}

NODE_MODULE(localizeImage, Init)
