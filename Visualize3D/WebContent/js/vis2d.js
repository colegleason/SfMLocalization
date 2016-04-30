var getUrlParameter = function getUrlParameter(sParam) {
    var sPageURL = decodeURIComponent(window.location.search.substring(1));
    var sURLVariables = sPageURL.split('&');
    for (var i = 0; i < sURLVariables.length; i++) {
	var sParameterName = sURLVariables[i].split('=');

	if (sParameterName[0] === sParam) {
	    return sParameterName[1] === undefined ? true : sParameterName[1];
	}
    }
};

function flattenPoints(geometry) {
    geometry.vertices.forEach(function(vertex) {
        vertex.z = 0;
    });
    return geometry;
};

var MAP_NAME;
var USER_NAME;
var SFM_STRUCTURE_PLY_FILE;
var DENSE_STRUCTURE_PLY_FILE;
var SFM_CAMERA_PLY_FILE;
var USER_HISTORY_JSON_FILE;
var BOUNDING_HISTORY_JSON_FILE;
var HOTSPOT_API_URL;
var SERVER_URL = 'http://hulop.qolt.cs.cmu.edu:3000';
var VIZMAP_SERVER_URL = 'http://hulop.qolt.cs.cmu.edu:5000';
var LOCALIZE_API_URL = SERVER_URL + '/localize';
var MAP_API_URL = SERVER_URL + '/map';
var USER_API_URL = SERVER_URL + '/user';
var BOUNDING_API_URL = SERVER_URL + '/bounding';
var SHOW_GRID = true;
var SHOW_SFM_CAMERA = true;
var SHOW_DENSE_SCENE = false;

$(document).ready(function(){
    if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

    MAP_NAME = getUrlParameter('map');
    if (!MAP_NAME) {
	document.write('Please specify map parameter');
	return;
    }
    USER_NAME = getUrlParameter('user');
    if (!USER_NAME) {
	document.write('Please specify user parameter');
	return;
    }
    SFM_STRUCTURE_PLY_FILE = MAP_API_URL + '/structure?name=' + MAP_NAME;
    SFM_CAMERA_PLY_FILE = MAP_API_URL + '/camera?name=' + MAP_NAME;
    DENSE_STRUCTURE_PLY_FILE = MAP_API_URL + '/dense?name=' + MAP_NAME;
    USER_HISTORY_JSON_FILE = USER_API_URL + '/history?name=' + USER_NAME;
    BOUNDING_HISTORY_JSON_FILE = BOUNDING_API_URL + '/history?name=' + USER_NAME;
    HOTSPOT_API_URL = VIZMAP_SERVER_URL + '/hotspots';

    // objects for drawing
    var container;
    var renderer, controls, scene, camera, scene2d, camera2d, sparseScene, denseScene;
    var gridParent;
    var sfmCameraParent;
    var sparseSceneParent;
    var denseSceneParent;
    var locCameraPointsParent;
    var boundingPointsParent;
    var hotspotsParent;

    // exec localize timer
    var userTimer = null;
    var boundingTimer = null;
    var hotspotTimer = null;

    prepareControl();
    init();
    animate();

    function prepareControl() {
	var controlcontainer = __get_control_container($("#container")).empty();
	$("<span/>",{
	    "class":"checkbox_label"
	}).html("Show Grid")
	    .appendTo(controlcontainer);
	$("<input/>",{
	    type:"checkbox",
	    checked:SHOW_GRID,
	    name:"showGrid",
	    value:"showGrid"
	}).appendTo(controlcontainer)
	    .on("change",function(){
		SHOW_GRID = $(this).is(":checked");
	    });

	$("<span/>",{
	    "class":"checkbox_label"
	}).html("Show Camera for SfM")
	    .appendTo(controlcontainer);
	$("<input/>",{
	    type:"checkbox",
	    checked:SHOW_SFM_CAMERA,
	    name:"showSfmCamera",
	    value:"showSfmCamera"
	}).appendTo(controlcontainer)
	    .on("change",function(){
		SHOW_SFM_CAMERA = $(this).is(":checked");
	    });

	$("<span/>",{
	    "class":"checkbox_label"
	}).html("Show Dense Structure")
	    .appendTo(controlcontainer);
	$("<input/>",{
	    type:"checkbox",
	    checked:SHOW_DENSE_SCENE,
	    name:"showDenseScene",
	    value:"showDenseScene"
	}).appendTo(controlcontainer)
	    .on("change",function(){
		SHOW_DENSE_SCENE = $(this).is(":checked");
	    });
    }

    function init() {
	// settings
	var fov = 65;
	var aspect = window.innerWidth / window.innerHeight;
	var near = 1;
	var far = 100;

	container = $("#container").get(0);

	// camera
	camera = new THREE.PerspectiveCamera( fov, aspect, near, far );
	camera.position.set( 0, 0, 10 );

	camera2d = new THREE.OrthographicCamera(0, window.innerWidth, 0, window.innerHeight, 0.001, 10000);

	// scene
	scene = new THREE.Scene();
	var axis = new THREE.AxisHelper(1);
	axis.position.set(0,0,0);
	scene.add(axis);

	scene2d = new THREE.Scene();

	// light
	var light = new THREE.DirectionalLight(0xffffff);
	light.position.set(0, 0, 100).normalize();
	scene.add(light);

	// controls
	controls = new THREE.TrackballControls(camera);
	controls.rotateSpeed = 5;
	controls.zoomSpeed = 5;
	controls.panSpeed = 5;
	controls.noZoom = false;
	controls.noPan = false;
	controls.staticMoving = true;
	controls.dynamicDampingFactor = 0.3;

	// draw grid plane
	gridParent = new THREE.Object3D();
	var maxGridAbsVal = 30;
	var gridGap = 1;

	var geometry = new THREE.Geometry();
	geometry.vertices.push(new THREE.Vector3(-1*maxGridAbsVal, 0, 0));
	geometry.vertices.push(new THREE.Vector3(maxGridAbsVal, 0, 0));

	linesMaterial = new THREE.LineBasicMaterial( { color: 0x00000, opacity: .2, linewidth: .1 } );
	for ( var i = 0; i <= 2*maxGridAbsVal/gridGap; i ++ ) {
	    var line = new THREE.Line( geometry, linesMaterial );
	    line.position.y = ( i * gridGap ) - maxGridAbsVal;
	    gridParent.add( line );

	    var line = new THREE.Line( geometry, linesMaterial );
	    line.position.x = ( i * gridGap ) - maxGridAbsVal;
	    line.rotation.z = 90 * Math.PI / 180;
	    gridParent.add( line );
	}
	scene.add(gridParent);

	// draw structure PLY file
	sparseSceneParent = new THREE.Object3D();
	var loader = new THREE.PLYLoader();
	loader.addEventListener( 'load', function ( event ) {
	    var geometry = event.content;
            //flattenPoints(geometry);
	    var materials = new THREE.PointCloudMaterial( { size: 0.05, vertexColors: THREE.VertexColors, transparent: true } );
	    var particles = new THREE.PointCloud(geometry, materials);
	    particles.colors = event.content.colors;
	    sparseSceneParent.add( particles );
	} );
	loader.load( SFM_STRUCTURE_PLY_FILE );
	scene.add(sparseSceneParent);

	// draw camera PLY file
	sfmCameraParent = new THREE.Object3D();
	var loader = new THREE.PLYLoader();
	loader.addEventListener( 'load', function ( event ) {
	    var geometry = event.content;
            //flattenpoints(geometry);
	    var materials = new THREE.PointCloudMaterial( { size: 0.05, vertexColors: THREE.VertexColors, transparent: true } );
	    var particles = new THREE.PointCloud(geometry, materials);
	    particles.colors = geometry.colors;
	    sfmCameraParent.add( particles );
	    loadUserHistory();
	} );
	loader.load( SFM_CAMERA_PLY_FILE );
	scene.add(sfmCameraParent);
        loadBoundingHistory();
        loadHotspots();
	// dense PLY file
	// denseSceneParent = new THREE.Object3D();
	// var loader = new THREE.PLYLoader();
	// loader.addEventListener( 'load', function ( event ) {
	//     var geometry = event.content;
	//     var materials = new THREE.PointCloudMaterial( { size: 0.05, vertexColors: THREE.VertexColors, transparent: true } );
	//     var particles = new THREE.PointCloud(geometry, materials);
	//     particles.colors = event.content.colors;
	//    denseSceneParent.add( particles );
	//  } );
	//  loader.load( DENSE_STRUCTURE_PLY_FILE );
	//  scene.add(denseSceneParent);

	// prepare camera points parent
	locCameraPointsParent = new THREE.Object3D();
	scene.add(locCameraPointsParent);
        boundingPointsParent = new THREE.Object3D();
	scene.add(boundingPointsParent);
        hotspotsParent = new THREE.Object3D();
	scene.add(hotspotsParent);
	// renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.autoClear = false; // To draw 2D, disable auto clear and call clear manually
	renderer.setClearColor(0xFFFFFF, 1);
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );

	renderer.gammaInput = true;
	renderer.gammaOutput = true;

	renderer.shadowMapEnabled = true;
	renderer.shadowMapCullFace = THREE.CullFaceBack;

	container.appendChild( renderer.domElement );

	// resize
	window.addEventListener( 'resize', onWindowResize, false );

	// mouse
	document.addEventListener( 'mousedown', onDocumentMouseDown, true );
    }

    function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	camera2d.left = 0;
	camera2d.right = window.innerWidth;
	camera2d.top = 0;
	camera2d.bottom = window.innerHeight;
	camera2d.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );
    }

    function onDocumentMouseDown(e) {
        var rect = e.target.getBoundingClientRect();
        var mouseX = e.clientX - rect.left;
        var mouseY = e.clientY - rect.top;
        mouseX = (mouseX / window.innerWidth) * 2 -1;
        mouseY = -(mouseY / window.innerWidth) * 2 + 1;
        var pos = new THREE.Vector3(mouseX, mouseY, 1);
        pos.unproject(camera);
        var ray = new THREE.Raycaster(camera.position, pos.sub(camera.position).normalize());
        var objs = ray.intersectObjects(locCameraPointsParent.children);
        if (objs.length>0) {
            console.log("points clicked : " + objs[0].point.x + "," + objs[0].point.y + "," + objs[0].point.z);
        }
    }

    function animate() {
	requestAnimationFrame( animate );

	sparseSceneParent.visible = SHOW_DENSE_SCENE ? false : true;
	//denseSceneParent.visible = SHOW_DENSE_SCENE ? true : false;
	gridParent.visible = SHOW_GRID ? true : false;
	sfmCameraParent.visible = SHOW_SFM_CAMERA ? true : false;

	renderer.clear();
	renderer.render( scene, camera );
	renderer.render( scene2d, camera2d );
	controls.handleResize();
	controls.update();
    }

    function loadUserHistory(){
    	if (userTimer!=null) clearInterval(userTimer);
    	/*
	 timer = setInterval(function(){
	 $.ajax({
	 type: "GET",
	 url: USER_HISTORY_JSON_FILE,
	 dataType: "json",
	 success: function(jsonData) {
	 var data = jsonData["history"];
	 if (data.length>0) {
	 for(var i=locCameraPointsParent.children.length-1; i>=0; i--){
	 locCameraPointsParent.remove(locCameraPointsParent.children[i]);
	 };

	 var result = data[data.length-1]["estimate"];
	 //drawPoint(locCameraPointsParent, result["t"][0], result["t"][1], result["t"][2], 0x0000FF);
	 drawPyramid(locCameraPointsParent, result["t"][0], result["t"][1], result["t"][2], result["R"], 0xFF0000);
	 }
	 }
	 });
	 }, 1000);
	 */
	var color = 0xffff00;
	var avatar = __create_avatar({
	    l_intensity:1,
	    basemat:{color:color},
	    avatarmat:{color:color, opacity: .9, transparent:true},
	    camoffs: new THREE.Vector3(0,0,1.5)
	});
   	userTimer = setInterval(function(){
   	    $.ajax({
   		type: "GET",
   		url: USER_HISTORY_JSON_FILE,
   		dataType: "json",
   		success: function(jsonData) {
   		    var data = jsonData["history"];
   		    if (data.length>0) {
   			for(var i=locCameraPointsParent.children.length-1; i>=0; i--){
   			    locCameraPointsParent.remove(locCameraPointsParent.children[i]);
   			};

   			var result = data[data.length-1]["estimate"];
   			drawShape(locCameraPointsParent, avatar.clone(), result["t"][0], result["t"][1], result["t"][2], result["R"], 0xFF0000);
   		    }
   		},
                failure: console.log,
   	    });
   	}, 2000);
    }

    function loadBoundingHistory(){
    	if (boundingTimer!=null) clearInterval(boundingTimer);
   	boundingTimer = setInterval(function(){
   	    $.ajax({
   		type: "GET",
   		url: BOUNDING_HISTORY_JSON_FILE,
   		dataType: "json",
   		success: function(jsonData) {
   		    var data = jsonData["history"];
                    if (data.length > 0) {
                        for(var i=boundingPointsParent.children.length-1; i>=0; i--){
   			    boundingPointsParent.remove(boundingPointsParent.children[i]);
   			};
                        var boundingPointCloudMaterial = new THREE.PointCloudMaterial({
      	                    color: 0xFF0000,
      	                    size: 0.125
    	                });

                        data.forEach(function(result) {
                            result.boundingBoxResults.forEach(function(boundingBox) {
	                        var boundingPoints = new THREE.Geometry();
                                boundingBox.forEach(function(point) {
                                    boundingPoints.vertices.push(new THREE.Vector3(point.x, point.y, point.z));

                                });
                                var boundingPointCloud = new THREE.PointCloud(boundingPoints, boundingPointCloudMaterial);
	                        boundingPointsParent.add(boundingPointCloud);
                            });
                        });
                    }
   		},
                error: console.log,
   	    });
   	}, 2000);
    }

        function loadHotspots(){
    	    if (hotspotTimer!=null) clearInterval(boundingTimer);
   	    hotspotTimer = setInterval(function(){
   	        $.ajax({
   		    type: "GET",
   		    url: HOTSPOT_API_URL,
   		    dataType: "json",
   		    success: function(jsonData) {
   		        var data = jsonData["hotspots"];
                        if (data.length > 0) {
                            for(var i=hotspotsParent.children.length-1; i>=0; i--){
   			        hotspotsParent.remove(hotspotsParent.children[i]);
   			    };
                            var hotspotMaterial = new THREE.PointCloudMaterial({
      	                        color: 0x0000FF,
      	                        size: 0.5
    	                    });
                            var hotspots = new THREE.Geometry();
                            data.forEach(function(hotspot) {
                                hotspots.vertices.push(new THREE.Vector3(hotspot.x, hotspot.y, hotspot.z));
                            });
                            var pointCloud = new THREE.PointCloud(hotspots, hotspotMaterial);
                            hotspotsParent.add(pointCloud);
                        }
   		    },
                    error: console.log,
   	        });
   	    }, 2000);
        }

    function __get_control_container(container){
        var ret = container.find(".controlcontainer");
        if(ret.length == 0){
            ret = $("<div/>",{
        	style:"position:absolute; top:4px;left:4px;",
        	"class": "controlcontainer"
            }).appendTo(container);
        }
        return ret;
    }

    function drawPoint(parent, x, y, z, color) {
	var camPointCloudMaterial = new THREE.PointCloudMaterial({
      	    color: color,
      	    size: 0.5
    	});
	var camPoints = new THREE.Geometry();
	var vector3 = new THREE.Vector3(x, y, z);
	camPoints.vertices.push(vector3);
	var camPointCloud = new THREE.PointCloud(camPoints, camPointCloudMaterial);
	parent.add(camPointCloud);
    }

    function drawPyramid(parent, x, y, z, rotMat, color) {
        var FLIP_Z_ROTATE = true;
        var size = 0.1;

        var points1 = [];
        points1[0] = [0, 0, 0];
        points1[1] = [size, size, size*3];
        points1[2] = points1[0];
        points1[3] = [-size, size, size*3];
        points1[4] = points1[0];
        points1[5] = [size, -size, size*3];
        points1[6] = points1[0];
        points1[7] = [-size, -size, size*3];
        var geometry1 = new THREE.Geometry();
        for (var i=0; i<points1.length; i++) {
            geometry1.vertices[i] = new THREE.Vector3(points1[i][0],points1[i][1],points1[i][2]);
        }
        var material1 = new THREE.LineBasicMaterial({color:0xFF0000, linewidth:5});
        var lines1 = new THREE.Line(geometry1, material1);

        var points2 = [];
        points2[0] = [size, size, size*3];
        points2[1] = [-size, size, size*3];
        points2[2] = [-size, -size, size*3];
        points2[3] = [size, -size, size*3];
        points2[4] = points2[0];
        var geometry2 = new THREE.Geometry();
        for (var i=0; i<points2.length; i++) {
            geometry2.vertices[i] = new THREE.Vector3(points2[i][0],points2[i][1],points2[i][2]);
        }
        var material2 = new THREE.LineBasicMaterial({color:0xFFCC99, linewidth:5});
        var lines2 = new THREE.Line(geometry2, material2);

        var points3 = [];
        points3[0] = [size, -size, size*3];
        points3[1] = [-size, -size, size*3];
        points3[2] = [0, -size*2, size*3];
        points3[3] = points3[0];
        var geometry3 = new THREE.Geometry();
        for (var i=0; i<points3.length; i++) {
            geometry3.vertices[i] = new THREE.Vector3(points3[i][0],points3[i][1],points3[i][2]);
        }
        var material3 = new THREE.LineBasicMaterial({color:0x3399CC, linewidth:5});
        var lines3 = new THREE.Line(geometry3, material3);

        var pyramid = new THREE.Object3D();
        pyramid.add(lines1);
        pyramid.add(lines2);
        pyramid.add(lines3);

        if (FLIP_Z_ROTATE) {
	    pyramid.applyMatrix(new THREE.Matrix4().set(rotMat[0][0], -rotMat[0][1], -rotMat[0][2], x,
            				                -rotMat[1][0], rotMat[1][1], rotMat[1][2], y,
	            			                -rotMat[2][0], rotMat[2][1], rotMat[2][2], z,
            				                0, 0, 0, 1));
        } else {
	    pyramid.applyMatrix(new THREE.Matrix4().set(rotMat[0][0], rotMat[0][1], rotMat[0][2], x,
	        				        rotMat[1][0], rotMat[1][1], rotMat[1][2], y,
	        				        rotMat[2][0], rotMat[2][1], rotMat[2][2], z,
        					        0, 0, 0, 1));
        }
        parent.add(pyramid);
    }

    function __create_avatar(option){
        var opt = option || {};
        var bheight = opt.camoffs.length();
        var pmat = new THREE.MeshPhongMaterial(opt.avatarmat || {color:0xf2f2b0, opacity: .7, transparent:true});
        var blackpmat = new THREE.MeshPhongMaterial({color:0x000000, opacity: .7, transparent:true});
        var basepos = new THREE.Mesh(new THREE.SphereGeometry(bheight * .5, 16, 16), new THREE.MeshPhongMaterial(opt.basemat || {color:0x640125}));
        var campoint1 = new THREE.Mesh(new THREE.SphereGeometry(bheight * .16, 16, 16), blackpmat);
        var campoint2 = new THREE.Mesh(new THREE.SphereGeometry(bheight * .16, 16, 16), blackpmat);
        var person = new THREE.Mesh(
            new THREE.CylinderGeometry(bheight * .30, 0, bheight * 0.8,16),
            pmat
        );
        person.rotation.x =  Math.PI;
        var pos = new THREE.Vector3(0,0,0);
        var campos1 = new THREE.Vector3(bheight * 0.2,bheight * 0.3,bheight * 0.2);
        var campos2 = new THREE.Vector3(-bheight * 0.2,bheight * 0.3,bheight * 0.2);
        var poffs = new THREE.Vector3(0,bheight * 0.5,0);
        basepos.position.copy(pos);
        campoint1.position.copy(campos1);
        campoint2.position.copy(campos2);
        person.position.copy(pos).add(poffs);
        var ret = new THREE.Object3D();
        ret.add(basepos);
        ret.add(campoint1);
        ret.add(campoint2);
        ret.add(person);
        ret.rotation.x =  Math.PI/2;
        var avatar = new THREE.Object3D();
        avatar.add(ret);
        return avatar;
    }

    function drawShape(parent, shape, x, y, z, rotMat, color) {
        var FLIP_Z_ROTATE = false;
        var size = 0.3;
        if (FLIP_Z_ROTATE) {
	    shape.applyMatrix(new THREE.Matrix4().set(rotMat[0][0], -rotMat[0][1], -rotMat[0][2], x,
            				              -rotMat[1][0], rotMat[1][1], rotMat[1][2], y,
	            			              -rotMat[2][0], rotMat[2][1], rotMat[2][2], z,
            				              0, 0, 0, 1));
        } else {
	    shape.applyMatrix(new THREE.Matrix4().set(rotMat[0][0], rotMat[0][1], rotMat[0][2], x,
	        				      rotMat[1][0], rotMat[1][1], rotMat[1][2], y,
	        				      rotMat[2][0], rotMat[2][1], rotMat[2][2], z,
        					      0, 0, 0, 1));
        }
        shape.scale.x = size;
        shape.scale.y = size;
        shape.scale.z = size;
        parent.add(shape);
    }
});
