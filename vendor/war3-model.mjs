//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region model.ts
var model_exports = /* @__PURE__ */ __exportAll({
	CollisionShapeType: () => CollisionShapeType,
	FilterMode: () => FilterMode,
	GeosetAnimFlags: () => GeosetAnimFlags,
	LayerShading: () => LayerShading,
	LightType: () => LightType,
	LineType: () => LineType,
	MaterialRenderMode: () => MaterialRenderMode,
	NodeFlags: () => NodeFlags,
	NodeType: () => NodeType,
	ParticleEmitter2FilterMode: () => ParticleEmitter2FilterMode,
	ParticleEmitter2Flags: () => ParticleEmitter2Flags,
	ParticleEmitter2FramesFlags: () => ParticleEmitter2FramesFlags,
	ParticleEmitterFlags: () => ParticleEmitterFlags,
	ParticleEmitterPopcornFlags: () => ParticleEmitterPopcornFlags,
	TextureFlags: () => TextureFlags
});
var TextureFlags = /* @__PURE__ */ function(TextureFlags) {
	TextureFlags[TextureFlags["WrapWidth"] = 1] = "WrapWidth";
	TextureFlags[TextureFlags["WrapHeight"] = 2] = "WrapHeight";
	return TextureFlags;
}({});
var FilterMode = /* @__PURE__ */ function(FilterMode) {
	FilterMode[FilterMode["None"] = 0] = "None";
	FilterMode[FilterMode["Transparent"] = 1] = "Transparent";
	FilterMode[FilterMode["Blend"] = 2] = "Blend";
	FilterMode[FilterMode["Additive"] = 3] = "Additive";
	FilterMode[FilterMode["AddAlpha"] = 4] = "AddAlpha";
	FilterMode[FilterMode["Modulate"] = 5] = "Modulate";
	FilterMode[FilterMode["Modulate2x"] = 6] = "Modulate2x";
	return FilterMode;
}({});
var LineType = /* @__PURE__ */ function(LineType) {
	LineType[LineType["DontInterp"] = 0] = "DontInterp";
	LineType[LineType["Linear"] = 1] = "Linear";
	LineType[LineType["Hermite"] = 2] = "Hermite";
	LineType[LineType["Bezier"] = 3] = "Bezier";
	return LineType;
}({});
var LayerShading = /* @__PURE__ */ function(LayerShading) {
	LayerShading[LayerShading["Unshaded"] = 1] = "Unshaded";
	LayerShading[LayerShading["SphereEnvMap"] = 2] = "SphereEnvMap";
	LayerShading[LayerShading["TwoSided"] = 16] = "TwoSided";
	LayerShading[LayerShading["Unfogged"] = 32] = "Unfogged";
	LayerShading[LayerShading["NoDepthTest"] = 64] = "NoDepthTest";
	LayerShading[LayerShading["NoDepthSet"] = 128] = "NoDepthSet";
	return LayerShading;
}({});
var MaterialRenderMode = /* @__PURE__ */ function(MaterialRenderMode) {
	MaterialRenderMode[MaterialRenderMode["ConstantColor"] = 1] = "ConstantColor";
	MaterialRenderMode[MaterialRenderMode["SortPrimsFarZ"] = 16] = "SortPrimsFarZ";
	MaterialRenderMode[MaterialRenderMode["FullResolution"] = 32] = "FullResolution";
	return MaterialRenderMode;
}({});
var GeosetAnimFlags = /* @__PURE__ */ function(GeosetAnimFlags) {
	GeosetAnimFlags[GeosetAnimFlags["DropShadow"] = 1] = "DropShadow";
	GeosetAnimFlags[GeosetAnimFlags["Color"] = 2] = "Color";
	return GeosetAnimFlags;
}({});
var NodeFlags = /* @__PURE__ */ function(NodeFlags) {
	NodeFlags[NodeFlags["DontInheritTranslation"] = 1] = "DontInheritTranslation";
	NodeFlags[NodeFlags["DontInheritRotation"] = 2] = "DontInheritRotation";
	NodeFlags[NodeFlags["DontInheritScaling"] = 4] = "DontInheritScaling";
	NodeFlags[NodeFlags["Billboarded"] = 8] = "Billboarded";
	NodeFlags[NodeFlags["BillboardedLockX"] = 16] = "BillboardedLockX";
	NodeFlags[NodeFlags["BillboardedLockY"] = 32] = "BillboardedLockY";
	NodeFlags[NodeFlags["BillboardedLockZ"] = 64] = "BillboardedLockZ";
	NodeFlags[NodeFlags["CameraAnchored"] = 128] = "CameraAnchored";
	return NodeFlags;
}({});
var NodeType = /* @__PURE__ */ function(NodeType) {
	NodeType[NodeType["Helper"] = 0] = "Helper";
	NodeType[NodeType["Bone"] = 256] = "Bone";
	NodeType[NodeType["Light"] = 512] = "Light";
	NodeType[NodeType["EventObject"] = 1024] = "EventObject";
	NodeType[NodeType["Attachment"] = 2048] = "Attachment";
	NodeType[NodeType["ParticleEmitter"] = 4096] = "ParticleEmitter";
	NodeType[NodeType["CollisionShape"] = 8192] = "CollisionShape";
	NodeType[NodeType["RibbonEmitter"] = 16384] = "RibbonEmitter";
	return NodeType;
}({});
var CollisionShapeType = /* @__PURE__ */ function(CollisionShapeType) {
	CollisionShapeType[CollisionShapeType["Box"] = 0] = "Box";
	CollisionShapeType[CollisionShapeType["Sphere"] = 2] = "Sphere";
	return CollisionShapeType;
}({});
var ParticleEmitterFlags = /* @__PURE__ */ function(ParticleEmitterFlags) {
	ParticleEmitterFlags[ParticleEmitterFlags["EmitterUsesMDL"] = 32768] = "EmitterUsesMDL";
	ParticleEmitterFlags[ParticleEmitterFlags["EmitterUsesTGA"] = 65536] = "EmitterUsesTGA";
	return ParticleEmitterFlags;
}({});
var ParticleEmitter2Flags = /* @__PURE__ */ function(ParticleEmitter2Flags) {
	ParticleEmitter2Flags[ParticleEmitter2Flags["Unshaded"] = 32768] = "Unshaded";
	ParticleEmitter2Flags[ParticleEmitter2Flags["SortPrimsFarZ"] = 65536] = "SortPrimsFarZ";
	ParticleEmitter2Flags[ParticleEmitter2Flags["LineEmitter"] = 131072] = "LineEmitter";
	ParticleEmitter2Flags[ParticleEmitter2Flags["Unfogged"] = 262144] = "Unfogged";
	ParticleEmitter2Flags[ParticleEmitter2Flags["ModelSpace"] = 524288] = "ModelSpace";
	ParticleEmitter2Flags[ParticleEmitter2Flags["XYQuad"] = 1048576] = "XYQuad";
	return ParticleEmitter2Flags;
}({});
var ParticleEmitter2FilterMode = /* @__PURE__ */ function(ParticleEmitter2FilterMode) {
	ParticleEmitter2FilterMode[ParticleEmitter2FilterMode["Blend"] = 0] = "Blend";
	ParticleEmitter2FilterMode[ParticleEmitter2FilterMode["Additive"] = 1] = "Additive";
	ParticleEmitter2FilterMode[ParticleEmitter2FilterMode["Modulate"] = 2] = "Modulate";
	ParticleEmitter2FilterMode[ParticleEmitter2FilterMode["Modulate2x"] = 3] = "Modulate2x";
	ParticleEmitter2FilterMode[ParticleEmitter2FilterMode["AlphaKey"] = 4] = "AlphaKey";
	return ParticleEmitter2FilterMode;
}({});
var ParticleEmitter2FramesFlags = /* @__PURE__ */ function(ParticleEmitter2FramesFlags) {
	ParticleEmitter2FramesFlags[ParticleEmitter2FramesFlags["Head"] = 1] = "Head";
	ParticleEmitter2FramesFlags[ParticleEmitter2FramesFlags["Tail"] = 2] = "Tail";
	return ParticleEmitter2FramesFlags;
}({});
var LightType = /* @__PURE__ */ function(LightType) {
	LightType[LightType["Omnidirectional"] = 0] = "Omnidirectional";
	LightType[LightType["Directional"] = 1] = "Directional";
	LightType[LightType["Ambient"] = 2] = "Ambient";
	return LightType;
}({});
var ParticleEmitterPopcornFlags = /* @__PURE__ */ function(ParticleEmitterPopcornFlags) {
	ParticleEmitterPopcornFlags[ParticleEmitterPopcornFlags["Unshaded"] = 32768] = "Unshaded";
	ParticleEmitterPopcornFlags[ParticleEmitterPopcornFlags["SortPrimsFarZ"] = 65536] = "SortPrimsFarZ";
	ParticleEmitterPopcornFlags[ParticleEmitterPopcornFlags["Unfogged"] = 262144] = "Unfogged";
	return ParticleEmitterPopcornFlags;
}({});
//#endregion
//#region renderer/util.ts
function mat4fromRotationOrigin(out, rotation, origin) {
	const x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3], x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, ox = origin[0], oy = origin[1], oz = origin[2];
	out[0] = 1 - (yy + zz);
	out[1] = xy + wz;
	out[2] = xz - wy;
	out[3] = 0;
	out[4] = xy - wz;
	out[5] = 1 - (xx + zz);
	out[6] = yz + wx;
	out[7] = 0;
	out[8] = xz + wy;
	out[9] = yz - wx;
	out[10] = 1 - (xx + yy);
	out[11] = 0;
	out[12] = ox - (out[0] * ox + out[4] * oy + out[8] * oz);
	out[13] = oy - (out[1] * ox + out[5] * oy + out[9] * oz);
	out[14] = oz - (out[2] * ox + out[6] * oy + out[10] * oz);
	out[15] = 1;
	return out;
}
function rand(from, to) {
	return from + Math.random() * (to - from);
}
function degToRad(angle) {
	return angle * Math.PI / 180;
}
function getShader(gl, source, type) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		alert(gl.getShaderInfoLog(shader));
		return null;
	}
	return shader;
}
function isWebGL2(gl) {
	return gl instanceof WebGL2RenderingContext;
}
var LAYER_TEXTURE_NAME_MAP = {
	"TextureID": 0,
	"NormalTextureID": 1,
	"ORMTextureID": 2,
	"EmissiveTextureID": 3,
	"TeamColorTextureID": 4,
	"ReflectionsTextureID": 5
};
var LAYER_TEXTURE_ID_MAP = [
	"TextureID",
	"NormalTextureID",
	"ORMTextureID",
	"EmissiveTextureID",
	"TeamColorTextureID",
	"ReflectionsTextureID"
];
//#endregion
//#region mdl/parse.ts
var State$1 = class {
	constructor(str) {
		this.str = str;
		this.pos = 0;
	}
	char() {
		if (this.pos >= this.str.length) throwError(this, "incorrect model data");
		return this.str[this.pos];
	}
};
function throwError(state, str = "") {
	throw new Error(`SyntaxError, near ${state.pos}` + (str ? ", " + str : ""));
}
function parseComment(state) {
	if (state.char() === "/" && state.str[state.pos + 1] === "/") {
		state.pos += 2;
		while (state.pos < state.str.length && state.str[++state.pos] !== "\n");
		++state.pos;
		return true;
	}
	return false;
}
var spaceRE = /\s/i;
function parseSpace(state) {
	while (state.pos < state.str.length && spaceRE.test(state.char())) ++state.pos;
}
var keywordFirstCharRE = /[a-z]/i;
var keywordOtherCharRE = /[a-z0-9]/i;
function parseKeyword(state) {
	if (!keywordFirstCharRE.test(state.char())) return null;
	let keyword = state.char();
	++state.pos;
	while (keywordOtherCharRE.test(state.char())) keyword += state.str[state.pos++];
	parseSpace(state);
	return keyword;
}
function parseSymbol(state, symbol) {
	if (state.char() === symbol) {
		++state.pos;
		parseSpace(state);
	}
}
function strictParseSymbol(state, symbol) {
	if (state.char() !== symbol) throwError(state, `extected ${symbol}`);
	++state.pos;
	parseSpace(state);
}
function parseString(state) {
	if (state.char() === "\"") {
		const start = ++state.pos;
		while (state.char() !== "\"") ++state.pos;
		++state.pos;
		const res = state.str.substring(start, state.pos - 1);
		parseSpace(state);
		return res;
	}
	return null;
}
var numberFirstCharRE = /[-0-9]/;
var numberOtherCharRE = /[-+.0-9e]/i;
function parseNumber(state) {
	if (numberFirstCharRE.test(state.char())) {
		const start = state.pos;
		++state.pos;
		while (numberOtherCharRE.test(state.char())) ++state.pos;
		const res = parseFloat(state.str.substring(start, state.pos));
		parseSpace(state);
		return res;
	}
	return null;
}
function parseArray(state, arr, pos) {
	if (state.char() !== "{") return null;
	if (!arr) {
		arr = [];
		pos = 0;
	}
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const num = parseNumber(state);
		if (num === null) throwError(state, "expected number");
		arr[pos++] = num;
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	return arr;
}
function parseArrayCounted(state, arr, pos) {
	if (state.char() !== "{") return 0;
	const start = pos;
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const num = parseNumber(state);
		if (num === null) throwError(state, "expected number");
		arr[pos++] = num;
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	return pos - start;
}
function parseArrayOrSingleItem(state, arr) {
	if (state.char() !== "{") {
		arr[0] = parseNumber(state);
		return arr;
	}
	let pos = 0;
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const num = parseNumber(state);
		if (num === null) throwError(state, "expected number");
		arr[pos++] = num;
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	return arr;
}
function parseObject(state) {
	let prefix = null;
	const obj = {};
	if (state.char() !== "{") {
		prefix = parseString(state);
		if (prefix === null) prefix = parseNumber(state);
		if (prefix === null) throwError(state, "expected string or number");
	}
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Interval") obj[keyword] = parseArray(state, new Uint32Array(2), 0);
		else if (keyword === "MinimumExtent" || keyword === "MaximumExtent") obj[keyword] = parseArray(state, new Float32Array(3), 0);
		else {
			obj[keyword] = parseArray(state) || parseString(state);
			if (obj[keyword] === null) obj[keyword] = parseNumber(state);
		}
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	return [prefix, obj];
}
function parseVersion$1(state, model) {
	const [_unused, obj] = parseObject(state);
	if (obj.FormatVersion) model.Version = obj.FormatVersion;
}
function parseModelInfo$1(state, model) {
	const [name, obj] = parseObject(state);
	model.Info = obj;
	model.Info.Name = name;
}
function parseSequences$1(state, model) {
	parseNumber(state);
	strictParseSymbol(state, "{");
	const res = [];
	while (state.char() !== "}") {
		parseKeyword(state);
		const [name, obj] = parseObject(state);
		obj.Name = name;
		obj.NonLooping = "NonLooping" in obj;
		obj.MoveSpeed = obj.MoveSpeed || 0;
		obj.Rarity = obj.Rarity || 0;
		res.push(obj);
	}
	strictParseSymbol(state, "}");
	model.Sequences = res;
}
function parseTextures$1(state, model) {
	const res = [];
	parseNumber(state);
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		parseKeyword(state);
		const [_unused, obj] = parseObject(state);
		obj.Flags = 0;
		if ("WrapWidth" in obj) {
			obj.Flags += TextureFlags.WrapWidth;
			delete obj.WrapWidth;
		}
		if ("WrapHeight" in obj) {
			obj.Flags += TextureFlags.WrapHeight;
			delete obj.WrapHeight;
		}
		res.push(obj);
	}
	strictParseSymbol(state, "}");
	model.Textures = res;
}
var AnimVectorType$2 = /* @__PURE__ */ function(AnimVectorType) {
	AnimVectorType[AnimVectorType["INT1"] = 0] = "INT1";
	AnimVectorType[AnimVectorType["FLOAT1"] = 1] = "FLOAT1";
	AnimVectorType[AnimVectorType["FLOAT3"] = 2] = "FLOAT3";
	AnimVectorType[AnimVectorType["FLOAT4"] = 3] = "FLOAT4";
	return AnimVectorType;
}(AnimVectorType$2 || {});
var animVectorSize$2 = {
	[AnimVectorType$2.INT1]: 1,
	[AnimVectorType$2.FLOAT1]: 1,
	[AnimVectorType$2.FLOAT3]: 3,
	[AnimVectorType$2.FLOAT4]: 4
};
function parseAnimKeyframe(state, frame, type, lineType) {
	const res = {
		Frame: frame,
		Vector: null
	};
	const Vector = type === AnimVectorType$2.INT1 ? Int32Array : Float32Array;
	const itemCount = animVectorSize$2[type];
	res.Vector = parseArrayOrSingleItem(state, new Vector(itemCount));
	strictParseSymbol(state, ",");
	if (lineType === LineType.Hermite || lineType === LineType.Bezier) {
		parseKeyword(state);
		res.InTan = parseArrayOrSingleItem(state, new Vector(itemCount));
		strictParseSymbol(state, ",");
		parseKeyword(state);
		res.OutTan = parseArrayOrSingleItem(state, new Vector(itemCount));
		strictParseSymbol(state, ",");
	}
	return res;
}
function parseAnimVector(state, type) {
	const animVector = {
		LineType: LineType.DontInterp,
		GlobalSeqId: null,
		Keys: []
	};
	parseNumber(state);
	strictParseSymbol(state, "{");
	const lineType = parseKeyword(state);
	if (lineType === "DontInterp" || lineType === "Linear" || lineType === "Hermite" || lineType === "Bezier") animVector.LineType = LineType[lineType];
	strictParseSymbol(state, ",");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (keyword === "GlobalSeqId") {
			animVector[keyword] = parseNumber(state);
			strictParseSymbol(state, ",");
		} else {
			const frame = parseNumber(state);
			if (frame === null) throwError(state, "expected frame number or GlobalSeqId");
			strictParseSymbol(state, ":");
			animVector.Keys.push(parseAnimKeyframe(state, frame, type, animVector.LineType));
		}
	}
	strictParseSymbol(state, "}");
	return animVector;
}
function parseLayer(state, model) {
	const res = {
		Alpha: null,
		TVertexAnimId: null,
		Shading: 0,
		CoordId: 0
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (!isStatic && (keyword === "TextureID" || model.Version >= 1100 && keyword in LAYER_TEXTURE_NAME_MAP)) res[keyword] = parseAnimVector(state, AnimVectorType$2.INT1);
		else if (!isStatic && keyword === "Alpha") res[keyword] = parseAnimVector(state, AnimVectorType$2.FLOAT1);
		else if (keyword === "Unshaded" || keyword === "SphereEnvMap" || keyword === "TwoSided" || keyword === "Unfogged" || keyword === "NoDepthTest" || keyword === "NoDepthSet") res.Shading |= LayerShading[keyword];
		else if (keyword === "FilterMode") {
			const val = parseKeyword(state);
			if (val === "None" || val === "Transparent" || val === "Blend" || val === "Additive" || val === "AddAlpha" || val === "Modulate" || val === "Modulate2x") res.FilterMode = FilterMode[val];
		} else if (keyword === "TVertexAnimId") res.TVertexAnimId = parseNumber(state);
		else if (model.Version >= 900 && keyword === "EmissiveGain") if (isStatic) res[keyword] = parseNumber(state);
		else res[keyword] = parseAnimVector(state, AnimVectorType$2.FLOAT1);
		else if (model.Version >= 1e3 && keyword === "FresnelColor") if (isStatic) res[keyword] = parseArray(state, new Float32Array(3), 0);
		else res[keyword] = parseAnimVector(state, AnimVectorType$2.FLOAT3);
		else if (model.Version >= 1e3 && (keyword === "FresnelOpacity" || keyword === "FresnelTeamColor")) if (isStatic) res[keyword] = parseNumber(state);
		else res[keyword] = parseAnimVector(state, AnimVectorType$2.FLOAT1);
		else {
			let val = parseNumber(state);
			if (val === null) val = parseKeyword(state);
			res[keyword] = val;
		}
		parseSymbol(state, ",");
		parseComment(state);
		parseSpace(state);
	}
	strictParseSymbol(state, "}");
	return res;
}
function parseMaterials$1(state, model) {
	const res = [];
	parseNumber(state);
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const obj = {
			RenderMode: 0,
			Layers: []
		};
		parseKeyword(state);
		strictParseSymbol(state, "{");
		while (state.char() !== "}") {
			const keyword = parseKeyword(state);
			if (!keyword) throwError(state);
			if (keyword === "Layer") obj.Layers.push(parseLayer(state, model));
			else if (keyword === "PriorityPlane" || keyword === "RenderMode") obj[keyword] = parseNumber(state);
			else if (keyword === "ConstantColor" || keyword === "SortPrimsFarZ" || keyword === "FullResolution") obj.RenderMode |= MaterialRenderMode[keyword];
			else if (model.Version >= 900 && model.Version <= 1100 && keyword === "Shader") obj[keyword] = parseString(state);
			else throw new Error("Unknown material property " + keyword);
			parseSymbol(state, ",");
		}
		strictParseSymbol(state, "}");
		res.push(obj);
	}
	strictParseSymbol(state, "}");
	model.Materials = res;
}
var GeosetPartType = /* @__PURE__ */ function(GeosetPartType) {
	GeosetPartType[GeosetPartType["INT"] = 0] = "INT";
	GeosetPartType[GeosetPartType["FLOAT"] = 1] = "FLOAT";
	return GeosetPartType;
}(GeosetPartType || {});
function parseGeosetPart(state, countPerObj, type) {
	const count = parseNumber(state);
	const arr = new (type === GeosetPartType.FLOAT ? Float32Array : Uint8Array)(count * countPerObj);
	strictParseSymbol(state, "{");
	for (let index = 0; index < count; ++index) {
		parseArray(state, arr, index * countPerObj);
		strictParseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	return arr;
}
function parseGeoset(state, model) {
	const res = {
		Vertices: null,
		Normals: null,
		TVertices: [],
		VertexGroup: new Uint8Array(0),
		Faces: null,
		Groups: null,
		TotalGroupsCount: null,
		MinimumExtent: null,
		MaximumExtent: null,
		BoundsRadius: 0,
		Anims: [],
		MaterialID: null,
		SelectionGroup: null,
		Unselectable: false
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Vertices" || keyword === "Normals" || keyword === "TVertices") {
			let countPerObj = 3;
			if (keyword === "TVertices") countPerObj = 2;
			const arr = parseGeosetPart(state, countPerObj, GeosetPartType.FLOAT);
			if (keyword === "TVertices") res.TVertices.push(arr);
			else res[keyword] = arr;
		} else if (keyword === "VertexGroup") {
			res[keyword] = new Uint8Array(res.Vertices.length / 3);
			parseArray(state, res[keyword], 0);
		} else if (keyword === "Faces") {
			const groupCount = parseNumber(state);
			const indexCount = parseNumber(state);
			let pos = 0;
			res.Faces = new Uint16Array(indexCount);
			strictParseSymbol(state, "{");
			if (parseKeyword(state) !== "Triangles") throwError(state, "unexpected faces type");
			strictParseSymbol(state, "{");
			for (let g = 0; g < groupCount; ++g) {
				const count = parseArrayCounted(state, res.Faces, pos);
				if (!count) throwError(state, "expected array");
				pos += count;
				parseSymbol(state, ",");
			}
			if (pos !== indexCount || indexCount % 3 !== 0) throwError(state, "mismatched faces array");
			strictParseSymbol(state, "}");
			strictParseSymbol(state, "}");
		} else if (keyword === "Groups") {
			const groups = [];
			parseNumber(state);
			res.TotalGroupsCount = parseNumber(state);
			strictParseSymbol(state, "{");
			while (state.char() !== "}") {
				parseKeyword(state);
				groups.push(parseArray(state));
				parseSymbol(state, ",");
			}
			strictParseSymbol(state, "}");
			res.Groups = groups;
		} else if (keyword === "MinimumExtent" || keyword === "MaximumExtent") {
			res[keyword] = parseArray(state, new Float32Array(3), 0);
			strictParseSymbol(state, ",");
		} else if (keyword === "BoundsRadius" || keyword === "MaterialID" || keyword === "SelectionGroup") {
			res[keyword] = parseNumber(state);
			strictParseSymbol(state, ",");
		} else if (keyword === "Anim") {
			const [_unused, obj] = parseObject(state);
			if (obj.Alpha === void 0) obj.Alpha = 1;
			res.Anims.push(obj);
		} else if (keyword === "Unselectable") {
			res.Unselectable = true;
			strictParseSymbol(state, ",");
		} else if (model.Version >= 900) {
			if (keyword === "LevelOfDetail") {
				res.LevelOfDetail = parseNumber(state);
				strictParseSymbol(state, ",");
			} else if (keyword === "Name") {
				res.Name = parseString(state);
				strictParseSymbol(state, ",");
			} else if (keyword === "Tangents") res.Tangents = parseGeosetPart(state, 4, GeosetPartType.FLOAT);
			else if (keyword === "SkinWeights") res.SkinWeights = parseGeosetPart(state, 8, GeosetPartType.INT);
		}
	}
	strictParseSymbol(state, "}");
	model.Geosets.push(res);
}
function parseGeosetAnim(state, model) {
	const res = {
		GeosetId: -1,
		Alpha: 1,
		Color: null,
		Flags: 0
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (keyword === "Alpha") if (isStatic) res.Alpha = parseNumber(state);
		else res.Alpha = parseAnimVector(state, AnimVectorType$2.FLOAT1);
		else if (keyword === "Color") if (isStatic) {
			res.Color = parseArray(state, new Float32Array(3), 0);
			res.Color.reverse();
		} else {
			res.Color = parseAnimVector(state, AnimVectorType$2.FLOAT3);
			for (const key of res.Color.Keys) {
				key.Vector.reverse();
				if (key.InTan) {
					key.InTan.reverse();
					key.OutTan.reverse();
				}
			}
		}
		else if (keyword === "DropShadow") res.Flags |= GeosetAnimFlags[keyword];
		else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.GeosetAnims.push(res);
}
function parseNode$1(state, type, model) {
	const node = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Flags: NodeType[type]
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling" || keyword === "Visibility") {
			let vectorType = AnimVectorType$2.FLOAT3;
			if (keyword === "Rotation") vectorType = AnimVectorType$2.FLOAT4;
			else if (keyword === "Visibility") vectorType = AnimVectorType$2.FLOAT1;
			node[keyword] = parseAnimVector(state, vectorType);
		} else if (keyword === "BillboardedLockZ" || keyword === "BillboardedLockY" || keyword === "BillboardedLockX" || keyword === "Billboarded" || keyword === "CameraAnchored") node.Flags |= NodeFlags[keyword];
		else if (keyword === "DontInherit") {
			strictParseSymbol(state, "{");
			const val = parseKeyword(state);
			if (val === "Translation") node.Flags |= NodeFlags.DontInheritTranslation;
			else if (val === "Rotation") node.Flags |= NodeFlags.DontInheritRotation;
			else if (val === "Scaling") node.Flags |= NodeFlags.DontInheritScaling;
			strictParseSymbol(state, "}");
		} else if (keyword === "Path") node[keyword] = parseString(state);
		else {
			let val = parseKeyword(state) || parseNumber(state);
			if (keyword === "GeosetId" && val === "Multiple" || keyword === "GeosetAnimId" && val === "None") val = null;
			node[keyword] = val;
		}
		parseSymbol(state, ",");
		parseComment(state);
		parseSpace(state);
	}
	strictParseSymbol(state, "}");
	model.Nodes[node.ObjectId] = node;
	return node;
}
function parseBone(state, model) {
	const node = parseNode$1(state, "Bone", model);
	model.Bones.push(node);
}
function parseHelper(state, model) {
	const node = parseNode$1(state, "Helper", model);
	model.Helpers.push(node);
}
function parseAttachment(state, model) {
	const node = parseNode$1(state, "Attachment", model);
	model.Attachments.push(node);
}
function parsePivotPoints$1(state, model) {
	const count = parseNumber(state);
	const res = [];
	strictParseSymbol(state, "{");
	for (let i = 0; i < count; ++i) {
		res.push(parseArray(state, new Float32Array(3), 0));
		strictParseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.PivotPoints = res;
}
function parseEventObject(state, model) {
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		EventTrack: null,
		Flags: NodeType.EventObject
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "EventTrack") {
			const count = parseNumber(state);
			res.EventTrack = parseArray(state, new Uint32Array(count), 0);
		} else if (keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling") res[keyword] = parseAnimVector(state, keyword === "Rotation" ? AnimVectorType$2.FLOAT4 : AnimVectorType$2.FLOAT3);
		else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.EventObjects.push(res);
	model.Nodes[res.ObjectId] = res;
}
function parseCollisionShape(state, model) {
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Shape: CollisionShapeType.Box,
		Vertices: null,
		Flags: NodeType.CollisionShape
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Sphere") res.Shape = CollisionShapeType.Sphere;
		else if (keyword === "Box") res.Shape = CollisionShapeType.Box;
		else if (keyword === "Vertices") {
			const count = parseNumber(state);
			const vertices = new Float32Array(count * 3);
			strictParseSymbol(state, "{");
			for (let i = 0; i < count; ++i) {
				parseArray(state, vertices, i * 3);
				strictParseSymbol(state, ",");
			}
			strictParseSymbol(state, "}");
			res.Vertices = vertices;
		} else if (keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling") res[keyword] = parseAnimVector(state, keyword === "Rotation" ? AnimVectorType$2.FLOAT4 : AnimVectorType$2.FLOAT3);
		else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.CollisionShapes.push(res);
	model.Nodes[res.ObjectId] = res;
}
function parseGlobalSequences$1(state, model) {
	const res = [];
	const count = parseNumber(state);
	strictParseSymbol(state, "{");
	for (let i = 0; i < count; ++i) {
		if (parseKeyword(state) === "Duration") res.push(parseNumber(state));
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.GlobalSequences = res;
}
function parseUnknownBlock(state) {
	let opened;
	while (state.char() !== void 0 && state.char() !== "{") ++state.pos;
	opened = 1;
	++state.pos;
	while (state.char() !== void 0 && opened > 0) {
		if (state.char() === "{") ++opened;
		else if (state.char() === "}") --opened;
		++state.pos;
	}
	parseSpace(state);
}
function parseParticleEmitter(state, model) {
	const res = {
		ObjectId: null,
		Parent: null,
		Name: null,
		Flags: 0
	};
	res.Name = parseString(state);
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (keyword === "ObjectId" || keyword === "Parent") res[keyword] = parseNumber(state);
		else if (keyword === "EmitterUsesMDL" || keyword === "EmitterUsesTGA") res.Flags |= ParticleEmitterFlags[keyword];
		else if (!isStatic && (keyword === "Visibility" || keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling" || keyword === "EmissionRate" || keyword === "Gravity" || keyword === "Longitude" || keyword === "Latitude")) {
			let type = AnimVectorType$2.FLOAT3;
			if (keyword === "Visibility" || keyword === "EmissionRate" || keyword === "Gravity" || keyword === "Longitude" || keyword === "Latitude") type = AnimVectorType$2.FLOAT1;
			else if (keyword === "Rotation") type = AnimVectorType$2.FLOAT4;
			res[keyword] = parseAnimVector(state, type);
		} else if (keyword === "Particle") {
			strictParseSymbol(state, "{");
			while (state.char() !== "}") {
				let keyword2 = parseKeyword(state);
				let isStatic2 = false;
				if (keyword2 === "static") {
					isStatic2 = true;
					keyword2 = parseKeyword(state);
				}
				if (!isStatic2 && (keyword2 === "LifeSpan" || keyword2 === "InitVelocity")) res[keyword2] = parseAnimVector(state, AnimVectorType$2.FLOAT1);
				else if (keyword2 === "LifeSpan" || keyword2 === "InitVelocity") res[keyword2] = parseNumber(state);
				else if (keyword2 === "Path") res.Path = parseString(state);
				parseSymbol(state, ",");
			}
			strictParseSymbol(state, "}");
		} else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.ParticleEmitters.push(res);
}
function parseParticleEmitter2(state, model) {
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Flags: NodeType.ParticleEmitter,
		FrameFlags: 0
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (!isStatic && (keyword === "Speed" || keyword === "Latitude" || keyword === "Visibility" || keyword === "EmissionRate" || keyword === "Width" || keyword === "Length" || keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling" || keyword === "Gravity" || keyword === "Variation")) {
			let type = AnimVectorType$2.FLOAT3;
			switch (keyword) {
				case "Rotation":
					type = AnimVectorType$2.FLOAT4;
					break;
				case "Speed":
				case "Latitude":
				case "Visibility":
				case "EmissionRate":
				case "Width":
				case "Length":
				case "Gravity":
				case "Variation":
					type = AnimVectorType$2.FLOAT1;
					break;
			}
			res[keyword] = parseAnimVector(state, type);
		} else if (keyword === "Variation" || keyword === "Gravity" || keyword === "ReplaceableId" || keyword === "PriorityPlane") res[keyword] = parseNumber(state);
		else if (keyword === "SortPrimsFarZ" || keyword === "Unshaded" || keyword === "LineEmitter" || keyword === "Unfogged" || keyword === "ModelSpace" || keyword === "XYQuad") res.Flags |= ParticleEmitter2Flags[keyword];
		else if (keyword === "Both") res.FrameFlags |= ParticleEmitter2FramesFlags.Head | ParticleEmitter2FramesFlags.Tail;
		else if (keyword === "Head" || keyword === "Tail") res.FrameFlags |= ParticleEmitter2FramesFlags[keyword];
		else if (keyword === "Squirt") res[keyword] = true;
		else if (keyword === "DontInherit") {
			strictParseSymbol(state, "{");
			const val = parseKeyword(state);
			if (val === "Translation") res.Flags |= NodeFlags.DontInheritTranslation;
			else if (val === "Rotation") res.Flags |= NodeFlags.DontInheritRotation;
			else if (val === "Scaling") res.Flags |= NodeFlags.DontInheritScaling;
			strictParseSymbol(state, "}");
		} else if (keyword === "SegmentColor") {
			const colors = [];
			strictParseSymbol(state, "{");
			while (state.char() !== "}") {
				parseKeyword(state);
				const colorArr = new Float32Array(3);
				parseArray(state, colorArr, 0);
				const temp = colorArr[0];
				colorArr[0] = colorArr[2];
				colorArr[2] = temp;
				colors.push(colorArr);
				parseSymbol(state, ",");
			}
			strictParseSymbol(state, "}");
			res.SegmentColor = colors;
		} else if (keyword === "Alpha") {
			res.Alpha = new Uint8Array(3);
			parseArray(state, res.Alpha, 0);
		} else if (keyword === "ParticleScaling") {
			res[keyword] = new Float32Array(3);
			parseArray(state, res[keyword], 0);
		} else if (keyword === "LifeSpanUVAnim" || keyword === "DecayUVAnim" || keyword === "TailUVAnim" || keyword === "TailDecayUVAnim") {
			res[keyword] = new Uint32Array(3);
			parseArray(state, res[keyword], 0);
		} else if (keyword === "Transparent" || keyword === "Blend" || keyword === "Additive" || keyword === "AlphaKey" || keyword === "Modulate" || keyword === "Modulate2x") res.FilterMode = ParticleEmitter2FilterMode[keyword];
		else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.ParticleEmitters2.push(res);
	model.Nodes[res.ObjectId] = res;
}
function parseCamera(state, model) {
	const res = {
		Name: null,
		Position: null,
		FieldOfView: 0,
		NearClip: 0,
		FarClip: 0,
		TargetPosition: null
	};
	res.Name = parseString(state);
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Position") {
			res.Position = new Float32Array(3);
			parseArray(state, res.Position, 0);
		} else if (keyword === "FieldOfView" || keyword === "NearClip" || keyword === "FarClip") res[keyword] = parseNumber(state);
		else if (keyword === "Target") {
			strictParseSymbol(state, "{");
			while (state.char() !== "}") {
				const keyword2 = parseKeyword(state);
				if (keyword2 === "Position") {
					res.TargetPosition = new Float32Array(3);
					parseArray(state, res.TargetPosition, 0);
				} else if (keyword2 === "Translation") res.TargetTranslation = parseAnimVector(state, AnimVectorType$2.FLOAT3);
				parseSymbol(state, ",");
			}
			strictParseSymbol(state, "}");
		} else if (keyword === "Translation" || keyword === "Rotation") res[keyword] = parseAnimVector(state, keyword === "Rotation" ? AnimVectorType$2.FLOAT1 : AnimVectorType$2.FLOAT3);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.Cameras.push(res);
}
function parseLight(state, model) {
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Flags: NodeType.Light,
		LightType: 0
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (!isStatic && (keyword === "Visibility" || keyword === "Color" || keyword === "Intensity" || keyword === "AmbIntensity" || keyword === "AmbColor" || keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling" || keyword === "AttenuationStart" || keyword === "AttenuationEnd")) {
			let type = AnimVectorType$2.FLOAT3;
			switch (keyword) {
				case "Rotation":
					type = AnimVectorType$2.FLOAT4;
					break;
				case "Visibility":
				case "Intensity":
				case "AmbIntensity":
				case "AttenuationStart":
				case "AttenuationEnd":
					type = AnimVectorType$2.FLOAT1;
					break;
			}
			res[keyword] = parseAnimVector(state, type);
			if (keyword === "Color" || keyword === "AmbColor") for (const key of res[keyword].Keys) {
				key.Vector.reverse();
				if (key.InTan) {
					key.InTan.reverse();
					key.OutTan.reverse();
				}
			}
		} else if (keyword === "Omnidirectional" || keyword === "Directional" || keyword === "Ambient") res.LightType = LightType[keyword];
		else if (keyword === "Color" || keyword === "AmbColor") {
			const color = new Float32Array(3);
			parseArray(state, color, 0);
			const temp = color[0];
			color[0] = color[2];
			color[2] = temp;
			res[keyword] = color;
		} else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.Lights.push(res);
	model.Nodes[res.ObjectId] = res;
}
function parseTextureAnims$1(state, model) {
	const res = [];
	parseNumber(state);
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const obj = {};
		parseKeyword(state);
		strictParseSymbol(state, "{");
		while (state.char() !== "}") {
			const keyword = parseKeyword(state);
			if (!keyword) throwError(state);
			if (keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling") obj[keyword] = parseAnimVector(state, keyword === "Rotation" ? AnimVectorType$2.FLOAT4 : AnimVectorType$2.FLOAT3);
			else throw new Error("Unknown texture anim property " + keyword);
			parseSymbol(state, ",");
		}
		strictParseSymbol(state, "}");
		res.push(obj);
	}
	strictParseSymbol(state, "}");
	model.TextureAnims = res;
}
function parseRibbonEmitter(state, model) {
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Flags: NodeType.RibbonEmitter,
		HeightAbove: null,
		HeightBelow: null,
		Alpha: null,
		Color: null,
		LifeSpan: null,
		TextureSlot: null,
		EmissionRate: null,
		Rows: null,
		Columns: null,
		MaterialID: 0,
		Gravity: null,
		Visibility: null
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (!isStatic && (keyword === "Visibility" || keyword === "HeightAbove" || keyword === "HeightBelow" || keyword === "Translation" || keyword === "Rotation" || keyword === "Scaling" || keyword === "Alpha" || keyword === "TextureSlot")) {
			let type = AnimVectorType$2.FLOAT3;
			switch (keyword) {
				case "Rotation":
					type = AnimVectorType$2.FLOAT4;
					break;
				case "Visibility":
				case "HeightAbove":
				case "HeightBelow":
				case "Alpha":
					type = AnimVectorType$2.FLOAT1;
					break;
				case "TextureSlot":
					type = AnimVectorType$2.INT1;
					break;
			}
			res[keyword] = parseAnimVector(state, type);
		} else if (keyword === "Color") {
			const color = new Float32Array(3);
			parseArray(state, color, 0);
			const temp = color[0];
			color[0] = color[2];
			color[2] = temp;
			res[keyword] = color;
		} else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.RibbonEmitters.push(res);
	model.Nodes[res.ObjectId] = res;
}
function parseFaceFX$1(state, model) {
	if (model.Version < 900) throwError(state, "Unexpected model chunk FaceFX");
	const res = {
		Name: parseString(state),
		Path: ""
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		const keyword = parseKeyword(state);
		if (!keyword) throwError(state);
		if (keyword === "Path") res.Path = parseString(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.FaceFX = model.FaceFX || [];
	model.FaceFX.push(res);
}
function parseBindPose$1(state, model) {
	if (model.Version < 900) throwError(state, "Unexpected model chunk BindPose");
	const res = { Matrices: [] };
	strictParseSymbol(state, "{");
	parseKeyword(state);
	const count = parseNumber(state);
	strictParseSymbol(state, "{");
	for (let i = 0; i < count; ++i) {
		const matrix = new Float32Array(12);
		parseArray(state, matrix, 0);
		parseSymbol(state, ",");
		res.Matrices.push(matrix);
	}
	strictParseSymbol(state, "}");
	strictParseSymbol(state, "}");
	model.BindPoses = model.BindPoses || [];
	model.BindPoses.push(res);
}
function parseParticleEmitterPopcorn$1(state, model) {
	if (model.Version < 900) throwError(state, "Unexpected model chunk ParticleEmitterPopcorn");
	const res = {
		Name: parseString(state),
		ObjectId: null,
		Parent: null,
		PivotPoint: null,
		Flags: NodeType.ParticleEmitter
	};
	strictParseSymbol(state, "{");
	while (state.char() !== "}") {
		let keyword = parseKeyword(state);
		let isStatic = false;
		if (!keyword) throwError(state);
		if (keyword === "static") {
			isStatic = true;
			keyword = parseKeyword(state);
		}
		if (!isStatic && (keyword === "LifeSpan" || keyword === "EmissionRate" || keyword === "Speed" || keyword === "Color" || keyword === "Alpha" || keyword === "Visibility" || keyword === "Rotation" || keyword === "Scaling" || keyword === "Translation")) {
			let type = AnimVectorType$2.FLOAT3;
			switch (keyword) {
				case "LifeSpan":
				case "EmissionRate":
				case "Speed":
				case "Alpha":
				case "Visibility":
					type = AnimVectorType$2.FLOAT1;
					break;
			}
			res[keyword] = parseAnimVector(state, type);
		} else if (keyword === "LifeSpan" || keyword === "EmissionRate" || keyword === "Speed" || keyword === "Alpha") res[keyword] = parseNumber(state);
		else if (keyword === "Color") res[keyword] = parseArray(state, new Float32Array(3), 0);
		else if (keyword === "ReplaceableId") res[keyword] = parseNumber(state);
		else if (keyword === "Path" || keyword === "AnimVisibilityGuide") res[keyword] = parseString(state);
		else if (keyword === "Unshaded" || keyword === "SortPrimsFarZ" || keyword === "Unfogged") {
			if (keyword === "Unshaded") res.Flags |= ParticleEmitterPopcornFlags.Unshaded;
			else if (keyword === "Unfogged") res.Flags |= ParticleEmitterPopcornFlags.Unfogged;
			else if (keyword === "SortPrimsFarZ") res.Flags |= ParticleEmitterPopcornFlags.SortPrimsFarZ;
		} else res[keyword] = parseNumber(state);
		parseSymbol(state, ",");
	}
	strictParseSymbol(state, "}");
	model.ParticleEmitterPopcorns = model.ParticleEmitterPopcorns || [];
	model.ParticleEmitterPopcorns.push(res);
	model.Nodes[res.ObjectId] = res;
}
var parsers$1 = {
	Version: parseVersion$1,
	Model: parseModelInfo$1,
	Sequences: parseSequences$1,
	Textures: parseTextures$1,
	Materials: parseMaterials$1,
	Geoset: parseGeoset,
	GeosetAnim: parseGeosetAnim,
	Bone: parseBone,
	Helper: parseHelper,
	Attachment: parseAttachment,
	PivotPoints: parsePivotPoints$1,
	EventObject: parseEventObject,
	CollisionShape: parseCollisionShape,
	GlobalSequences: parseGlobalSequences$1,
	ParticleEmitter: parseParticleEmitter,
	ParticleEmitter2: parseParticleEmitter2,
	Camera: parseCamera,
	Light: parseLight,
	TextureAnims: parseTextureAnims$1,
	RibbonEmitter: parseRibbonEmitter,
	FaceFX: parseFaceFX$1,
	BindPose: parseBindPose$1,
	ParticleEmitterPopcorn: parseParticleEmitterPopcorn$1
};
function parse(str) {
	const state = new State$1(str);
	const model = {
		Version: 800,
		Info: {
			Name: "",
			MinimumExtent: null,
			MaximumExtent: null,
			BoundsRadius: 0,
			BlendTime: 150
		},
		Sequences: [],
		GlobalSequences: [],
		Textures: [],
		Materials: [],
		TextureAnims: [],
		Geosets: [],
		GeosetAnims: [],
		Bones: [],
		Helpers: [],
		Attachments: [],
		EventObjects: [],
		ParticleEmitters: [],
		ParticleEmitters2: [],
		Cameras: [],
		Lights: [],
		RibbonEmitters: [],
		CollisionShapes: [],
		PivotPoints: [],
		Nodes: []
	};
	while (state.pos < state.str.length) {
		while (parseComment(state));
		const keyword = parseKeyword(state);
		if (keyword) if (keyword in parsers$1) parsers$1[keyword](state, model);
		else parseUnknownBlock(state);
		else break;
	}
	for (let i = 0; i < model.Nodes.length; ++i) if (model.PivotPoints[i]) model.Nodes[i].PivotPoint = model.PivotPoints[i];
	return model;
}
//#endregion
//#region mdx/parse.ts
var BIG_ENDIAN$1 = true;
var NONE$1 = -1;
var AnimVectorType$1 = /* @__PURE__ */ function(AnimVectorType) {
	AnimVectorType[AnimVectorType["INT1"] = 0] = "INT1";
	AnimVectorType[AnimVectorType["FLOAT1"] = 1] = "FLOAT1";
	AnimVectorType[AnimVectorType["FLOAT3"] = 2] = "FLOAT3";
	AnimVectorType[AnimVectorType["FLOAT4"] = 3] = "FLOAT4";
	return AnimVectorType;
}(AnimVectorType$1 || {});
var animVectorSize$1 = {
	[AnimVectorType$1.INT1]: 1,
	[AnimVectorType$1.FLOAT1]: 1,
	[AnimVectorType$1.FLOAT3]: 3,
	[AnimVectorType$1.FLOAT4]: 4
};
var State = class {
	constructor(arrayBuffer) {
		this.ab = arrayBuffer;
		this.pos = 0;
		this.length = arrayBuffer.byteLength;
		this.view = new DataView(this.ab);
		this.uint = new Uint8Array(this.ab);
	}
	keyword() {
		const res = String.fromCharCode(this.uint[this.pos], this.uint[this.pos + 1], this.uint[this.pos + 2], this.uint[this.pos + 3]);
		this.pos += 4;
		return res;
	}
	expectKeyword(keyword, errorText) {
		if (this.keyword() !== keyword) throw new Error(errorText);
	}
	uint8() {
		return this.view.getUint8(this.pos++);
	}
	uint16() {
		const res = this.view.getUint16(this.pos, BIG_ENDIAN$1);
		this.pos += 2;
		return res;
	}
	int32() {
		const res = this.view.getInt32(this.pos, BIG_ENDIAN$1);
		this.pos += 4;
		return res;
	}
	float32() {
		const res = this.view.getFloat32(this.pos, BIG_ENDIAN$1);
		this.pos += 4;
		return res;
	}
	float32Array(len) {
		const res = new Float32Array(len);
		for (let i = 0; i < len; ++i) res[i] = this.float32();
		return res;
	}
	uint8Array(len) {
		const res = new Uint8Array(len);
		for (let i = 0; i < len; ++i) res[i] = this.uint8();
		return res;
	}
	str(length) {
		let stringLength = length;
		while (this.uint[this.pos + stringLength - 1] === 0 && stringLength > 0) --stringLength;
		const res = String.fromCharCode.apply(String, this.uint.slice(this.pos, this.pos + stringLength));
		this.pos += length;
		return res;
	}
	animVector(type) {
		const res = { Keys: [] };
		const isInt = type === AnimVectorType$1.INT1;
		const vectorSize = animVectorSize$1[type];
		const keysCount = this.int32();
		res.LineType = this.int32();
		res.GlobalSeqId = this.int32();
		if (res.GlobalSeqId === NONE$1) res.GlobalSeqId = null;
		for (let i = 0; i < keysCount; ++i) {
			const animKeyFrame = {};
			animKeyFrame.Frame = this.int32();
			if (isInt) animKeyFrame.Vector = new Int32Array(vectorSize);
			else animKeyFrame.Vector = new Float32Array(vectorSize);
			for (let j = 0; j < vectorSize; ++j) if (isInt) animKeyFrame.Vector[j] = this.int32();
			else animKeyFrame.Vector[j] = this.float32();
			if (res.LineType === LineType.Hermite || res.LineType === LineType.Bezier) for (const part of ["InTan", "OutTan"]) {
				animKeyFrame[part] = new Float32Array(vectorSize);
				for (let j = 0; j < vectorSize; ++j) if (isInt) animKeyFrame[part][j] = this.int32();
				else animKeyFrame[part][j] = this.float32();
			}
			res.Keys.push(animKeyFrame);
		}
		return res;
	}
};
function parseExtent(obj, state) {
	obj.BoundsRadius = state.float32();
	for (const key of ["MinimumExtent", "MaximumExtent"]) {
		obj[key] = new Float32Array(3);
		for (let i = 0; i < 3; ++i) obj[key][i] = state.float32();
	}
}
function parseVersion(model, state) {
	model.Version = state.int32();
}
var MODEL_NAME_LENGTH$1 = 336;
function parseModelInfo(model, state) {
	model.Info.Name = state.str(MODEL_NAME_LENGTH$1);
	state.int32();
	parseExtent(model.Info, state);
	model.Info.BlendTime = state.int32();
}
var MODEL_SEQUENCE_NAME_LENGTH$1 = 80;
function parseSequences(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const name = state.str(MODEL_SEQUENCE_NAME_LENGTH$1);
		const sequence = {};
		sequence.Name = name;
		const interval = new Uint32Array(2);
		interval[0] = state.int32();
		interval[1] = state.int32();
		sequence.Interval = interval;
		sequence.MoveSpeed = state.float32();
		sequence.NonLooping = state.int32() > 0;
		sequence.Rarity = state.float32();
		state.int32();
		parseExtent(sequence, state);
		model.Sequences.push(sequence);
	}
}
function parseMaterials(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		state.int32();
		const material = { Layers: [] };
		material.PriorityPlane = state.int32();
		material.RenderMode = state.int32();
		if (model.Version >= 900 && model.Version < 1100) material.Shader = state.str(80);
		state.expectKeyword("LAYS", "Incorrect materials format");
		const layersCount = state.int32();
		for (let i = 0; i < layersCount; ++i) {
			const startPos2 = state.pos;
			const size2 = state.int32();
			const layer = {};
			layer.FilterMode = state.int32();
			layer.Shading = state.int32();
			layer.TextureID = state.int32();
			layer.TVertexAnimId = state.int32();
			if (layer.TVertexAnimId === NONE$1) layer.TVertexAnimId = null;
			layer.CoordId = state.int32();
			layer.Alpha = state.float32();
			if (model.Version >= 900) {
				layer.EmissiveGain = state.float32();
				if (model.Version >= 1e3) {
					layer.FresnelColor = state.float32Array(3);
					layer.FresnelOpacity = state.float32();
					layer.FresnelTeamColor = state.float32();
				}
			}
			if (model.Version >= 1100) {
				layer.ShaderTypeId = state.int32();
				const textureCount = state.int32();
				for (let j = 0; j < textureCount; ++j) {
					const textureId = state.int32();
					state.int32();
					const textureType = j;
					if (state.keyword() === "KMTF") layer[LAYER_TEXTURE_ID_MAP[textureType]] = state.animVector(AnimVectorType$1.INT1);
					else {
						layer[LAYER_TEXTURE_ID_MAP[textureType]] = textureId;
						state.pos -= 4;
					}
				}
			}
			while (state.pos < startPos2 + size2) {
				const keyword = state.keyword();
				if (keyword === "KMTA") layer.Alpha = state.animVector(AnimVectorType$1.FLOAT1);
				else if (keyword === "KMTF") layer.TextureID = state.animVector(AnimVectorType$1.INT1);
				else if (keyword === "KMTE" && model.Version >= 900) layer.EmissiveGain = state.animVector(AnimVectorType$1.FLOAT1);
				else if (keyword === "KFC3" && model.Version >= 1e3) layer.FresnelColor = state.animVector(AnimVectorType$1.FLOAT3);
				else if (keyword === "KFCA" && model.Version >= 1e3) layer.FresnelOpacity = state.animVector(AnimVectorType$1.FLOAT1);
				else if (keyword === "KFTC" && model.Version >= 1e3) layer.FresnelTeamColor = state.animVector(AnimVectorType$1.FLOAT1);
				else throw new Error("Unknown layer chunk data " + keyword);
			}
			material.Layers.push(layer);
		}
		model.Materials.push(material);
	}
}
var MODEL_TEXTURE_PATH_LENGTH$1 = 256;
function parseTextures(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const texture = {};
		texture.ReplaceableId = state.int32();
		texture.Image = state.str(MODEL_TEXTURE_PATH_LENGTH$1);
		state.int32();
		texture.Flags = state.int32();
		model.Textures.push(texture);
	}
}
function parseGeosets(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const geoset = {};
		state.int32();
		state.expectKeyword("VRTX", "Incorrect geosets format");
		const verticesCount = state.int32();
		geoset.Vertices = new Float32Array(verticesCount * 3);
		for (let i = 0; i < verticesCount * 3; ++i) geoset.Vertices[i] = state.float32();
		state.expectKeyword("NRMS", "Incorrect geosets format");
		const normalsCount = state.int32();
		geoset.Normals = new Float32Array(normalsCount * 3);
		for (let i = 0; i < normalsCount * 3; ++i) geoset.Normals[i] = state.float32();
		state.expectKeyword("PTYP", "Incorrect geosets format");
		const primitiveCount = state.int32();
		for (let i = 0; i < primitiveCount; ++i) if (state.int32() !== 4) throw new Error("Incorrect geosets format");
		state.expectKeyword("PCNT", "Incorrect geosets format");
		const faceGroupCount = state.int32();
		for (let i = 0; i < faceGroupCount; ++i) state.int32();
		state.expectKeyword("PVTX", "Incorrect geosets format");
		const indicesCount = state.int32();
		geoset.Faces = new Uint16Array(indicesCount);
		for (let i = 0; i < indicesCount; ++i) geoset.Faces[i] = state.uint16();
		state.expectKeyword("GNDX", "Incorrect geosets format");
		const verticesGroupCount = state.int32();
		geoset.VertexGroup = new Uint8Array(verticesGroupCount);
		for (let i = 0; i < verticesGroupCount; ++i) geoset.VertexGroup[i] = state.uint8();
		state.expectKeyword("MTGC", "Incorrect geosets format");
		const groupsCount = state.int32();
		geoset.Groups = [];
		for (let i = 0; i < groupsCount; ++i) geoset.Groups[i] = new Array(state.int32());
		state.expectKeyword("MATS", "Incorrect geosets format");
		geoset.TotalGroupsCount = state.int32();
		let groupIndex = 0;
		let groupCounter = 0;
		for (let i = 0; i < geoset.TotalGroupsCount; ++i) {
			if (groupIndex >= geoset.Groups[groupCounter].length) {
				groupIndex = 0;
				groupCounter++;
			}
			geoset.Groups[groupCounter][groupIndex++] = state.int32();
		}
		geoset.MaterialID = state.int32();
		geoset.SelectionGroup = state.int32();
		geoset.Unselectable = state.int32() > 0;
		if (model.Version >= 900) {
			geoset.LevelOfDetail = state.int32();
			geoset.Name = state.str(80);
		}
		parseExtent(geoset, state);
		const geosetAnimCount = state.int32();
		geoset.Anims = [];
		for (let i = 0; i < geosetAnimCount; ++i) {
			const geosetAnim = {};
			parseExtent(geosetAnim, state);
			geoset.Anims.push(geosetAnim);
		}
		let keyword = state.keyword();
		if (model.Version >= 900) while (1) {
			if (state.pos >= state.length) throw new Error("Unexpected EOF");
			if (keyword === "TANG") {
				if (geoset.Tangents) throw new Error("Incorrect geoset, multiple Tangents");
				const len = state.int32();
				geoset.Tangents = state.float32Array(len * 4);
			} else if (keyword === "SKIN") {
				if (geoset.SkinWeights) throw new Error("Incorrect geoset, multiple SkinWeights");
				const len = state.int32();
				if (model.Version >= 1800) {
					geoset.SkinWeights = new Uint8Array(len);
					for (let index = 0; index < len; index++) {
						const value = state.uint16();
						if (value > 255) throw new Error("Skin element exceeds the renderer's 256-bone palette");
						geoset.SkinWeights[index] = value;
					}
				} else geoset.SkinWeights = state.uint8Array(len);
			} else if (keyword === "UVAS") break;
			keyword = state.keyword();
		}
		else if (keyword !== "UVAS") throw new Error("Incorrect geosets format");
		const textureChunkCount = state.int32();
		geoset.TVertices = [];
		for (let i = 0; i < textureChunkCount; ++i) {
			state.expectKeyword("UVBS", "Incorrect geosets format");
			const textureCoordsCount = state.int32();
			const tvertices = new Float32Array(textureCoordsCount * 2);
			for (let j = 0; j < textureCoordsCount * 2; ++j) tvertices[j] = state.float32();
			geoset.TVertices.push(tvertices);
		}
		model.Geosets.push(geoset);
	}
}
function parseGeosetAnims(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const animStartPos = state.pos;
		const animSize = state.int32();
		const geosetAnim = {};
		geosetAnim.Alpha = state.float32();
		geosetAnim.Flags = state.int32();
		geosetAnim.Color = new Float32Array(3);
		for (let i = 0; i < 3; ++i) geosetAnim.Color[i] = state.float32();
		geosetAnim.GeosetId = state.int32();
		if (geosetAnim.GeosetId === NONE$1) geosetAnim.GeosetId = null;
		while (state.pos < animStartPos + animSize) {
			const keyword = state.keyword();
			if (keyword === "KGAO") geosetAnim.Alpha = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KGAC") geosetAnim.Color = state.animVector(AnimVectorType$1.FLOAT3);
			else throw new Error("Incorrect GeosetAnim chunk data " + keyword);
		}
		model.GeosetAnims.push(geosetAnim);
	}
}
var MODEL_NODE_NAME_LENGTH$1 = 80;
function parseNode(model, node, state) {
	const startPos = state.pos;
	const size = state.int32();
	node.Name = state.str(MODEL_NODE_NAME_LENGTH$1);
	node.ObjectId = state.int32();
	if (node.ObjectId === NONE$1) node.ObjectId = null;
	node.Parent = state.int32();
	if (node.Parent === NONE$1) node.Parent = null;
	node.Flags = state.int32();
	while (state.pos < startPos + size) {
		const keyword = state.keyword();
		if (keyword === "KGTR") node.Translation = state.animVector(AnimVectorType$1.FLOAT3);
		else if (keyword === "KGRT") node.Rotation = state.animVector(AnimVectorType$1.FLOAT4);
		else if (keyword === "KGSC") node.Scaling = state.animVector(AnimVectorType$1.FLOAT3);
		else throw new Error("Incorrect node chunk data " + keyword);
	}
	model.Nodes[node.ObjectId] = node;
}
function parseBones(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const bone = {};
		parseNode(model, bone, state);
		bone.GeosetId = state.int32();
		if (bone.GeosetId === NONE$1) bone.GeosetId = null;
		bone.GeosetAnimId = state.int32();
		if (bone.GeosetAnimId === NONE$1) bone.GeosetAnimId = null;
		model.Bones.push(bone);
	}
}
function parseHelpers(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const helper = {};
		parseNode(model, helper, state);
		model.Helpers.push(helper);
	}
}
var MODEL_ATTACHMENT_PATH_LENGTH$1 = 256;
function parseAttachments(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const attachmentStart = state.pos;
		const attachmentSize = state.int32();
		const attachment = {};
		parseNode(model, attachment, state);
		attachment.Path = state.str(MODEL_ATTACHMENT_PATH_LENGTH$1);
		state.int32();
		attachment.AttachmentID = state.int32();
		if (state.pos < attachmentStart + attachmentSize) {
			state.expectKeyword("KATV", "Incorrect attachment chunk data");
			attachment.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
		}
		model.Attachments.push(attachment);
	}
}
function parsePivotPoints(model, state, size) {
	const pointsCount = size / 12;
	for (let i = 0; i < pointsCount; ++i) {
		model.PivotPoints[i] = new Float32Array(3);
		model.PivotPoints[i][0] = state.float32();
		model.PivotPoints[i][1] = state.float32();
		model.PivotPoints[i][2] = state.float32();
	}
}
function parseEventObjects(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const eventObject = {};
		parseNode(model, eventObject, state);
		state.expectKeyword("KEVT", "Incorrect EventObject chunk data");
		const eventTrackCount = state.int32();
		eventObject.EventTrack = new Uint32Array(eventTrackCount);
		state.int32();
		for (let i = 0; i < eventTrackCount; ++i) eventObject.EventTrack[i] = state.int32();
		model.EventObjects.push(eventObject);
	}
}
function parseCollisionShapes(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const collisionShape = {};
		parseNode(model, collisionShape, state);
		collisionShape.Shape = state.int32();
		if (collisionShape.Shape === CollisionShapeType.Box) collisionShape.Vertices = new Float32Array(6);
		else collisionShape.Vertices = new Float32Array(3);
		for (let i = 0; i < collisionShape.Vertices.length; ++i) collisionShape.Vertices[i] = state.float32();
		if (collisionShape.Shape === CollisionShapeType.Sphere) collisionShape.BoundsRadius = state.float32();
		model.CollisionShapes.push(collisionShape);
	}
}
function parseGlobalSequences(model, state, size) {
	const startPos = state.pos;
	model.GlobalSequences = [];
	while (state.pos < startPos + size) model.GlobalSequences.push(state.int32());
}
var MODEL_PARTICLE_EMITTER_PATH_LENGTH$1 = 256;
function parseParticleEmitters(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const emitterStart = state.pos;
		const emitterSize = state.int32();
		const emitter = {};
		parseNode(model, emitter, state);
		emitter.EmissionRate = state.float32();
		emitter.Gravity = state.float32();
		emitter.Longitude = state.float32();
		emitter.Latitude = state.float32();
		emitter.Path = state.str(MODEL_PARTICLE_EMITTER_PATH_LENGTH$1);
		state.int32();
		emitter.LifeSpan = state.float32();
		emitter.InitVelocity = state.float32();
		while (state.pos < emitterStart + emitterSize) {
			const keyword = state.keyword();
			if (keyword === "KPEV") emitter.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPEE") emitter.EmissionRate = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPEG") emitter.Gravity = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPLN") emitter.Longitude = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPLT") emitter.Latitude = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPEL") emitter.LifeSpan = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPES") emitter.InitVelocity = state.animVector(AnimVectorType$1.FLOAT1);
			else throw new Error("Incorrect particle emitter chunk data " + keyword);
		}
		model.ParticleEmitters.push(emitter);
	}
}
function parseParticleEmitters2(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const emitterStart = state.pos;
		const emitterSize = state.int32();
		const emitter = {};
		parseNode(model, emitter, state);
		emitter.Speed = state.float32();
		emitter.Variation = state.float32();
		emitter.Latitude = state.float32();
		emitter.Gravity = state.float32();
		emitter.LifeSpan = state.float32();
		emitter.EmissionRate = state.float32();
		emitter.Width = state.float32();
		emitter.Length = state.float32();
		emitter.FilterMode = state.int32();
		emitter.Rows = state.int32();
		emitter.Columns = state.int32();
		const frameFlags = state.int32();
		emitter.FrameFlags = 0;
		if (frameFlags === 0 || frameFlags === 2) emitter.FrameFlags |= ParticleEmitter2FramesFlags.Head;
		if (frameFlags === 1 || frameFlags === 2) emitter.FrameFlags |= ParticleEmitter2FramesFlags.Tail;
		emitter.TailLength = state.float32();
		emitter.Time = state.float32();
		emitter.SegmentColor = [];
		for (let i = 0; i < 3; ++i) {
			emitter.SegmentColor[i] = new Float32Array(3);
			for (let j = 0; j < 3; ++j) emitter.SegmentColor[i][j] = state.float32();
		}
		emitter.Alpha = new Uint8Array(3);
		for (let i = 0; i < 3; ++i) emitter.Alpha[i] = state.uint8();
		emitter.ParticleScaling = new Float32Array(3);
		for (let i = 0; i < 3; ++i) emitter.ParticleScaling[i] = state.float32();
		for (const part of [
			"LifeSpanUVAnim",
			"DecayUVAnim",
			"TailUVAnim",
			"TailDecayUVAnim"
		]) {
			emitter[part] = new Uint32Array(3);
			for (let i = 0; i < 3; ++i) emitter[part][i] = state.int32();
		}
		emitter.TextureID = state.int32();
		if (emitter.TextureID === NONE$1) emitter.TextureID = null;
		emitter.Squirt = state.int32() > 0;
		emitter.PriorityPlane = state.int32();
		emitter.ReplaceableId = state.int32();
		while (state.pos < emitterStart + emitterSize) {
			const keyword = state.keyword();
			if (keyword === "KP2V") emitter.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2E") emitter.EmissionRate = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2W") emitter.Width = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2N") emitter.Length = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2S") emitter.Speed = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2L") emitter.Latitude = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2G") emitter.Gravity = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KP2R") emitter.Variation = state.animVector(AnimVectorType$1.FLOAT1);
			else throw new Error("Incorrect particle emitter2 chunk data " + keyword);
		}
		model.ParticleEmitters2.push(emitter);
	}
}
var MODEL_CAMERA_NAME_LENGTH$1 = 80;
function parseCameras(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const cameraStart = state.pos;
		const cameraSize = state.int32();
		const camera = {};
		camera.Name = state.str(MODEL_CAMERA_NAME_LENGTH$1);
		camera.Position = new Float32Array(3);
		camera.Position[0] = state.float32();
		camera.Position[1] = state.float32();
		camera.Position[2] = state.float32();
		camera.FieldOfView = state.float32();
		camera.FarClip = state.float32();
		camera.NearClip = state.float32();
		camera.TargetPosition = new Float32Array(3);
		camera.TargetPosition[0] = state.float32();
		camera.TargetPosition[1] = state.float32();
		camera.TargetPosition[2] = state.float32();
		while (state.pos < cameraStart + cameraSize) {
			const keyword = state.keyword();
			if (keyword === "KCTR") camera.Translation = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KTTR") camera.TargetTranslation = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KCRL") camera.Rotation = state.animVector(AnimVectorType$1.FLOAT1);
			else throw new Error("Incorrect camera chunk data " + keyword);
		}
		model.Cameras.push(camera);
	}
}
function parseLights(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const lightStart = state.pos;
		const lightSize = state.int32();
		const light = {};
		parseNode(model, light, state);
		light.LightType = state.int32();
		if (model.Version >= 1300) light.ShadowCasting = state.int32();
		light.AttenuationStart = state.float32();
		light.AttenuationEnd = state.float32();
		light.Color = new Float32Array(3);
		for (let j = 0; j < 3; ++j) light.Color[j] = state.float32();
		light.Intensity = state.float32();
		light.AmbColor = new Float32Array(3);
		for (let j = 0; j < 3; ++j) light.AmbColor[j] = state.float32();
		light.AmbIntensity = state.float32();
		if (model.Version >= 1200) light.ShadowIntensity = state.float32();
		if (model.Version >= 1300) {
			light.ShadowCastingStart = state.float32();
			light.ShadowCastingEnd = state.float32();
		}
		if (model.Version >= 1600) {
			light.QuadraticFalloff = state.float32();
			light.LinearFalloff = state.float32();
			light.Damping = state.float32();
		}
		while (state.pos < lightStart + lightSize) {
			const keyword = state.keyword();
			if (keyword === "KLAV") light.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KLAC") light.Color = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KLAI") light.Intensity = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KLBC") light.AmbColor = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KLBI") light.AmbIntensity = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KLAS") light.AttenuationStart = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KLAE") light.AttenuationEnd = state.animVector(AnimVectorType$1.FLOAT1);
			else if (model.Version >= 1300 && keyword === "KLSS") light.ShadowCastingStart = state.animVector(AnimVectorType$1.FLOAT1);
			else if (model.Version >= 1300 && keyword === "KLSE") light.ShadowCastingEnd = state.animVector(AnimVectorType$1.FLOAT1);
			else if (model.Version >= 1600 && keyword === "KLQF") light.QuadraticFalloff = state.animVector(AnimVectorType$1.FLOAT1);
			else if (model.Version >= 1600 && keyword === "KLLF") light.LinearFalloff = state.animVector(AnimVectorType$1.FLOAT1);
			else if (model.Version >= 1600 && keyword === "KLDA") light.Damping = state.animVector(AnimVectorType$1.FLOAT1);
			else throw new Error("Incorrect light chunk data " + keyword);
		}
		model.Lights.push(light);
	}
}
function parseTextureAnims(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const animStart = state.pos;
		const animSize = state.int32();
		const anim = {};
		while (state.pos < animStart + animSize) {
			const keyword = state.keyword();
			if (keyword === "KTAT") anim.Translation = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KTAR") anim.Rotation = state.animVector(AnimVectorType$1.FLOAT4);
			else if (keyword === "KTAS") anim.Scaling = state.animVector(AnimVectorType$1.FLOAT3);
			else throw new Error("Incorrect light chunk data " + keyword);
		}
		model.TextureAnims.push(anim);
	}
}
function parseRibbonEmitters(model, state, size) {
	const startPos = state.pos;
	while (state.pos < startPos + size) {
		const emitterStart = state.pos;
		const emitterSize = state.int32();
		const emitter = {};
		parseNode(model, emitter, state);
		emitter.HeightAbove = state.float32();
		emitter.HeightBelow = state.float32();
		emitter.Alpha = state.float32();
		emitter.Color = new Float32Array(3);
		for (let j = 0; j < 3; ++j) emitter.Color[j] = state.float32();
		emitter.LifeSpan = state.float32();
		emitter.TextureSlot = state.int32();
		emitter.EmissionRate = state.int32();
		emitter.Rows = state.int32();
		emitter.Columns = state.int32();
		emitter.MaterialID = state.int32();
		emitter.Gravity = state.float32();
		while (state.pos < emitterStart + emitterSize) {
			const keyword = state.keyword();
			if (keyword === "KRVS") emitter.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KRHA") emitter.HeightAbove = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KRHB") emitter.HeightBelow = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KRAL") emitter.Alpha = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KRTX") emitter.TextureSlot = state.animVector(AnimVectorType$1.INT1);
			else throw new Error("Incorrect ribbon emitter chunk data " + keyword);
		}
		model.RibbonEmitters.push(emitter);
	}
}
function parseFaceFX(model, state, size) {
	if (model.Version < 900) throw new Error("Mismatched version chunk");
	const startPos = state.pos;
	model.FaceFX = model.FaceFX || [];
	while (state.pos < startPos + size) {
		const faceFX = {
			Name: "",
			Path: ""
		};
		faceFX.Name = state.str(80);
		faceFX.Path = state.str(260);
		model.FaceFX.push(faceFX);
	}
}
function parseBindPose(model, state, size) {
	if (model.Version < 900) throw new Error("Mismatched version chunk");
	const startPos = state.pos;
	model.BindPoses = model.BindPoses || [];
	const len = state.int32();
	const bindPose = { Matrices: [] };
	for (let i = 0; i < len; ++i) {
		const matrix = state.float32Array(12);
		bindPose.Matrices.push(matrix);
	}
	model.BindPoses.push(bindPose);
	if (state.pos !== startPos + size) throw new Error("Mismatched BindPose data");
}
function parseParticleEmitterPopcorn(model, state, size) {
	if (model.Version < 900) throw new Error("Mismatched version chunk");
	const startPos = state.pos;
	model.ParticleEmitterPopcorns = model.ParticleEmitterPopcorns || [];
	while (state.pos < startPos + size) {
		const emitterStart = state.pos;
		const emitterSize = state.int32();
		const emitter = {};
		parseNode(model, emitter, state);
		emitter.LifeSpan = state.float32();
		emitter.EmissionRate = state.float32();
		emitter.Speed = state.float32();
		emitter.Color = state.float32Array(3);
		emitter.Alpha = state.float32();
		emitter.ReplaceableId = state.int32();
		emitter.Path = state.str(260);
		emitter.AnimVisibilityGuide = state.str(260);
		while (state.pos < emitterStart + emitterSize) {
			const keyword = state.keyword();
			if (keyword === "KPPA") emitter.Alpha = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPPC") emitter.Color = state.animVector(AnimVectorType$1.FLOAT3);
			else if (keyword === "KPPE") emitter.EmissionRate = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPPL") emitter.LifeSpan = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPPS") emitter.Speed = state.animVector(AnimVectorType$1.FLOAT1);
			else if (keyword === "KPPV") emitter.Visibility = state.animVector(AnimVectorType$1.FLOAT1);
			else throw new Error("Incorrect particle emitter popcorn chunk data " + keyword);
		}
		model.ParticleEmitterPopcorns.push(emitter);
	}
}
var parsers = {
	VERS: parseVersion,
	MODL: parseModelInfo,
	SEQS: parseSequences,
	MTLS: parseMaterials,
	TEXS: parseTextures,
	GEOS: parseGeosets,
	GEOA: parseGeosetAnims,
	BONE: parseBones,
	HELP: parseHelpers,
	ATCH: parseAttachments,
	PIVT: parsePivotPoints,
	EVTS: parseEventObjects,
	CLID: parseCollisionShapes,
	GLBS: parseGlobalSequences,
	PREM: parseParticleEmitters,
	PRE2: parseParticleEmitters2,
	CAMS: parseCameras,
	LITE: parseLights,
	TXAN: parseTextureAnims,
	RIBB: parseRibbonEmitters,
	FAFX: parseFaceFX,
	BPOS: parseBindPose,
	CORN: parseParticleEmitterPopcorn
};
function parse$1(arrayBuffer) {
	const state = new State(arrayBuffer);
	if (state.keyword() !== "MDLX") throw new Error("Not a mdx model");
	const model = {
		Version: 800,
		Info: {
			Name: "",
			MinimumExtent: null,
			MaximumExtent: null,
			BoundsRadius: 0,
			BlendTime: 150
		},
		Sequences: [],
		GlobalSequences: [],
		Textures: [],
		Materials: [],
		TextureAnims: [],
		Geosets: [],
		GeosetAnims: [],
		Bones: [],
		Helpers: [],
		Attachments: [],
		EventObjects: [],
		ParticleEmitters: [],
		ParticleEmitters2: [],
		Cameras: [],
		Lights: [],
		RibbonEmitters: [],
		CollisionShapes: [],
		PivotPoints: [],
		Nodes: []
	};
	while (state.pos < state.length) {
		const keyword = state.keyword();
		const size = state.int32();
		if (keyword in parsers) parsers[keyword](model, state, size);
		else state.pos += size;
	}
	for (let i = 0; i < model.Nodes.length; ++i) if (model.Nodes[i] && model.PivotPoints[i]) model.Nodes[i].PivotPoint = model.PivotPoints[i];
	model.Info.NumGeosets = model.Geosets.length;
	model.Info.NumGeosetAnims = model.GeosetAnims.length;
	model.Info.NumBones = model.Bones.length;
	model.Info.NumLights = model.Lights.length;
	model.Info.NumAttachments = model.Attachments.length;
	model.Info.NumEvents = model.EventObjects.length;
	model.Info.NumParticleEmitters = model.ParticleEmitters.length;
	model.Info.NumParticleEmitters2 = model.ParticleEmitters2.length;
	model.Info.NumRibbonEmitters = model.RibbonEmitters.length;
	return model;
}
//#endregion
//#region mdl/generate.ts
var FLOAT_PRESICION = 6;
var EPSILON$1 = 1e-6;
function isNotEmptyVec3(vec, val = 0) {
	return Math.abs(vec[0] - val) > EPSILON$1 || Math.abs(vec[1] - val) > EPSILON$1 || Math.abs(vec[2] - val) > EPSILON$1;
}
function generateTab(tabSize = 1) {
	if (tabSize === 0) return "";
	let res = "	";
	for (let i = 1; i < tabSize; ++i) res += "	";
	return res;
}
function generateWrappedString(val) {
	return `"${val}"`;
}
function generateWrappedStringOrNumber(val) {
	if (typeof val === "number") return String(val);
	return generateWrappedString(val);
}
function generateBlockStart(blockName, subInfo = null, tabSize = 0) {
	return generateTab(tabSize) + blockName + " " + (subInfo !== null ? generateWrappedStringOrNumber(subInfo) + " " : "") + "{\n";
}
function generateBlockEnd(tabSize = 0) {
	return generateTab(tabSize) + "}\n";
}
var trailingZeroRegExp = /(\..+?)0+$/;
var trailingZeroRegExp2 = /\.0+$/;
var negativeZeroRegExp = /^-0$/;
function generateNumber(val) {
	return val.toFixed(FLOAT_PRESICION).replace(trailingZeroRegExp, "$1").replace(trailingZeroRegExp2, "").replace(negativeZeroRegExp, "0");
}
function generateArray(arr, reverse = false) {
	let middle = "";
	if (reverse) for (let i = arr.length - 1; i >= 0; --i) {
		if (i < arr.length - 1) middle += ", ";
		middle += generateNumber(arr[i]);
	}
	else for (let i = 0; i < arr.length; ++i) {
		if (i > 0) middle += ", ";
		middle += generateNumber(arr[i]);
	}
	return "{ " + middle + " }";
}
function generateUIntArray(arr) {
	let middle = "";
	for (let i = 0; i < arr.length; ++i) {
		if (i > 0) middle += ", ";
		middle += String(arr[i]);
	}
	return "{ " + middle + " }";
}
function generateStatic(isStatic) {
	return isStatic ? "static " : "";
}
function generateProp(name, val, isStatic, tabSize = 1) {
	return `${generateTab(tabSize) + generateStatic(isStatic) + name} ${val},\n`;
}
function generateIntProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, String(val), isStatic, tabSize);
}
function generateFloatProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, generateNumber(val), isStatic, tabSize);
}
function generateStringProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, val, isStatic, tabSize);
}
function generateWrappedStringProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, generateWrappedString(val), isStatic, tabSize);
}
function generateFloatArrayProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, generateArray(val), isStatic, tabSize);
}
function generateUIntArrayProp(name, val, isStatic = null, tabSize = 1) {
	return generateProp(name, generateUIntArray(val), isStatic, tabSize);
}
function generateBooleanProp(name, tabSize = 1) {
	return generateTab(tabSize) + name + ",\n";
}
function generateIntPropIfNotEmpty(name, val, defaultVal = 0, isStatic = null, tabSize = 1) {
	if (val !== defaultVal && val !== null && val !== void 0) return generateIntProp(name, val, isStatic, tabSize);
	return "";
}
function generateFloatPropIfNotEmpty(name, val, defaultVal = 0, isStatic = null, tabSize = 1) {
	if (Math.abs(val - defaultVal) > EPSILON$1) return generateFloatProp(name, val, isStatic, tabSize);
	return "";
}
function generateLineType(lineType) {
	switch (lineType) {
		case LineType.DontInterp: return "DontInterp";
		case LineType.Linear: return "Linear";
		case LineType.Bezier: return "Bezier";
		case LineType.Hermite: return "Hermite";
	}
	return "";
}
function generateAnimKeyFrame(key, tabSize = 2, reverse = false) {
	let res = generateTab(tabSize) + key.Frame + ": " + (key.Vector.length === 1 ? generateNumber(key.Vector[0]) : generateArray(key.Vector, reverse)) + ",\n";
	if (key.InTan) {
		res += generateTab(tabSize + 1) + "InTan " + (key.InTan.length === 1 ? generateNumber(key.InTan[0]) : generateArray(key.InTan, reverse)) + ",\n";
		res += generateTab(tabSize + 1) + "OutTan " + (key.OutTan.length === 1 ? generateNumber(key.OutTan[0]) : generateArray(key.OutTan, reverse)) + ",\n";
	}
	return res;
}
function generateAnimVectorProp(name, val, defaultVal = 0, tabSize = 1, reverse = false) {
	if (val === null || val === void 0) return "";
	if (typeof val === "number") if (typeof defaultVal === "number" && Math.abs(val - defaultVal) < EPSILON$1) return "";
	else return generateFloatProp(name, val, true, tabSize);
	else return generateBlockStart(name, val.Keys.length, tabSize) + generateBooleanProp(generateLineType(val.LineType), tabSize + 1) + (val.GlobalSeqId !== null ? generateIntProp("GlobalSeqId", val.GlobalSeqId, null, tabSize + 1) : "") + val.Keys.map((key) => generateAnimKeyFrame(key, tabSize + 1, reverse)).join("") + generateBlockEnd(tabSize);
}
function generateVersion$1(model) {
	return generateBlockStart("Version") + generateIntProp("FormatVersion", model.Version) + generateBlockEnd();
}
function generateModel(model) {
	return generateBlockStart("Model", model.Info.Name) + generateIntPropIfNotEmpty("NumGeosets", model.Geosets.length) + generateIntPropIfNotEmpty("NumGeosetAnims", model.GeosetAnims.length) + generateIntPropIfNotEmpty("NumHelpers", model.Helpers.length) + generateIntPropIfNotEmpty("NumBones", model.Bones.length) + (model.Lights.length ? generateIntPropIfNotEmpty("NumLights", model.Lights.length) : "") + generateIntPropIfNotEmpty("NumAttachments", model.Attachments.length) + generateIntPropIfNotEmpty("NumEvents", model.EventObjects.length) + generateIntPropIfNotEmpty("NumParticleEmitters", model.ParticleEmitters.length) + (model.ParticleEmitters2.length ? generateIntPropIfNotEmpty("NumParticleEmitters2", model.ParticleEmitters2.length) : "") + (model.RibbonEmitters.length ? generateIntPropIfNotEmpty("NumRibbonEmitters", model.RibbonEmitters.length) : "") + generateIntProp("BlendTime", model.Info.BlendTime) + generateFloatArrayProp("MinimumExtent", model.Info.MinimumExtent) + generateFloatArrayProp("MaximumExtent", model.Info.MaximumExtent) + generateFloatPropIfNotEmpty("BoundsRadius", model.Info.BoundsRadius) + generateBlockEnd();
}
function generateSequences$1(model) {
	return generateBlockStart("Sequences", model.Sequences.length) + model.Sequences.map(generateSequenceChunk).join("") + generateBlockEnd();
}
function generateSequenceChunk(sequence) {
	return generateBlockStart("Anim", sequence.Name, 1) + generateUIntArrayProp("Interval", sequence.Interval, null, 2) + generateFloatPropIfNotEmpty("Rarity", sequence.Rarity, 0, null, 2) + generateFloatPropIfNotEmpty("MoveSpeed", sequence.MoveSpeed, 0, null, 2) + (sequence.NonLooping ? generateBooleanProp("NonLooping", 2) : "") + generateFloatArrayProp("MinimumExtent", sequence.MinimumExtent, null, 2) + generateFloatArrayProp("MaximumExtent", sequence.MaximumExtent, null, 2) + generateFloatPropIfNotEmpty("BoundsRadius", sequence.BoundsRadius, 0, null, 2) + generateBlockEnd(1);
}
function generateGlobalSequences$1(model) {
	if (!model.GlobalSequences || !model.GlobalSequences.length) return "";
	return generateBlockStart("GlobalSequences", model.GlobalSequences.length) + model.GlobalSequences.map((duration) => generateIntProp("Duration", duration)).join("") + generateBlockEnd();
}
function generateTextures$1(model) {
	if (!model.Textures.length) return "";
	return generateBlockStart("Textures", model.Textures.length) + model.Textures.map(generateTextureChunk).join("") + generateBlockEnd();
}
function generateTextureChunk(texture) {
	return generateBlockStart("Bitmap", null, 1) + generateWrappedStringProp("Image", texture.Image, null, 2) + generateIntPropIfNotEmpty("ReplaceableId", texture.ReplaceableId, 0, null, 2) + (texture.Flags & TextureFlags.WrapWidth ? generateBooleanProp("WrapWidth", 2) : "") + (texture.Flags & TextureFlags.WrapHeight ? generateBooleanProp("WrapHeight", 2) : "") + generateBlockEnd(1);
}
function generateMaterials$1(model) {
	if (!model.Materials.length) return "";
	return generateBlockStart("Materials", model.Materials.length) + model.Materials.map((it) => generateMaterialChunk(model, it)).join("") + generateBlockEnd();
}
function generateMaterialChunk(model, material) {
	let shader = "";
	if (model.Version >= 900 && model.Version < 1100 && material.Shader) shader = generateWrappedStringProp("Shader", material.Shader, false, 2);
	return generateBlockStart("Material", null, 1) + (material.RenderMode & MaterialRenderMode.ConstantColor ? generateBooleanProp("ConstantColor", 2) : "") + (material.RenderMode & MaterialRenderMode.SortPrimsFarZ ? generateBooleanProp("SortPrimsFarZ", 2) : "") + (material.RenderMode & MaterialRenderMode.FullResolution ? generateBooleanProp("FullResolution", 2) : "") + generateIntPropIfNotEmpty("PriorityPlane", material.PriorityPlane, 0, null, 2) + generateIntPropIfNotEmpty("RenderMode", material.RenderMode, 0, null, 2) + shader + material.Layers.map((it) => generateLayerChunk(model, it)).join("") + generateBlockEnd(1);
}
function generateFilterMode(filterMode) {
	switch (filterMode) {
		case FilterMode.None: return "None";
		case FilterMode.Transparent: return "Transparent";
		case FilterMode.Blend: return "Blend";
		case FilterMode.Additive: return "Additive";
		case FilterMode.AddAlpha: return "AddAlpha";
		case FilterMode.Modulate: return "Modulate";
		case FilterMode.Modulate2x: return "Modulate2x";
	}
	return "";
}
function generateLayerChunk(model, layer) {
	let middle = "";
	if (model.Version >= 900) {
		middle += layer.EmissiveGain !== void 0 ? generateAnimVectorProp("EmissiveGain", layer.EmissiveGain, 1, 3) : "";
		if (model.Version >= 1e3) {
			middle += layer.FresnelColor !== void 0 ? generateColorProp("FresnelColor", layer.FresnelColor, true, 3) : "";
			middle += layer.FresnelOpacity !== void 0 ? generateAnimVectorProp("FresnelOpacity", layer.FresnelOpacity, 0, 3) : "";
			middle += layer.FresnelTeamColor !== void 0 ? generateAnimVectorProp("FresnelTeamColor", layer.FresnelTeamColor, 0, 3) : "";
		}
	}
	if (model.Version >= 1100) {
		middle += generateIntProp("ShaderTypeId", layer.ShaderTypeId || 0, null, 3);
		LAYER_TEXTURE_ID_MAP.slice(1).forEach((name) => {
			const val = layer[name];
			if (val !== void 0) middle += generateAnimVectorProp(name, val, null, 3);
		});
	}
	return generateBlockStart("Layer", null, 2) + generateStringProp("FilterMode", generateFilterMode(layer.FilterMode), null, 3) + (layer.Alpha !== void 0 ? generateAnimVectorProp("Alpha", layer.Alpha, 1, 3) : "") + (layer.TextureID !== void 0 ? generateAnimVectorProp("TextureID", layer.TextureID, null, 3) : "") + (layer.Shading & LayerShading.TwoSided ? generateBooleanProp("TwoSided", 3) : "") + (layer.Shading & LayerShading.Unshaded ? generateBooleanProp("Unshaded", 3) : "") + (layer.Shading & LayerShading.Unfogged ? generateBooleanProp("Unfogged", 3) : "") + (layer.Shading & LayerShading.SphereEnvMap ? generateBooleanProp("SphereEnvMap", 3) : "") + (layer.Shading & LayerShading.NoDepthTest ? generateBooleanProp("NoDepthTest", 3) : "") + (layer.Shading & LayerShading.NoDepthSet ? generateBooleanProp("NoDepthSet", 3) : "") + generateIntPropIfNotEmpty("CoordId", layer.CoordId, 0, null, 3) + generateIntPropIfNotEmpty("TVertexAnimId", layer.TVertexAnimId, null, null, 3) + middle + generateBlockEnd(2);
}
function generateTextureAnims$1(model) {
	if (!model.TextureAnims.length) return "";
	return generateBlockStart("TextureAnims", model.TextureAnims.length) + model.TextureAnims.map(generateTextureAnimChunk).join("") + generateBlockEnd();
}
function generateTextureAnimChunk(textureAnim) {
	return generateBlockStart("TVertexAnim", null, 1) + (textureAnim.Translation ? generateAnimVectorProp("Translation", textureAnim.Translation, null, 2) : "") + (textureAnim.Rotation ? generateAnimVectorProp("Rotation", textureAnim.Rotation, null, 2) : "") + (textureAnim.Scaling ? generateAnimVectorProp("Scaling", textureAnim.Scaling, null, 2) : "") + generateBlockEnd(1);
}
function generateGeosets$1(model) {
	if (!model.Geosets.length) return "";
	return model.Geosets.map((it) => generateGeosetChunk(model, it)).join("");
}
function generateGeosetChunk(model, geoset) {
	let middle = "";
	if (model.Version >= 900) middle += (geoset.LevelOfDetail !== void 0 ? generateIntProp("LevelOfDetail", geoset.LevelOfDetail) : "") + (geoset.Name ? generateWrappedStringProp("Name", geoset.Name) : "") + (geoset.Tangents ? generateGeosetArray("Tangents", geoset.Tangents, 4) : "") + (geoset.SkinWeights ? generateGeosetArray("SkinWeights", geoset.SkinWeights, 8) : "");
	return generateBlockStart("Geoset") + generateGeosetArray("Vertices", geoset.Vertices, 3) + generateGeosetArray("Normals", geoset.Normals, 3) + generateGeosetArray("TVertices", geoset.TVertices[0], 2) + generateGeosetVertexGroup(geoset.VertexGroup) + generateGeosetFaces(geoset.Faces) + generateGeosetGroups(geoset.Groups) + generateFloatArrayProp("MinimumExtent", geoset.MinimumExtent) + generateFloatArrayProp("MaximumExtent", geoset.MaximumExtent) + generateFloatPropIfNotEmpty("BoundsRadius", geoset.BoundsRadius) + generateGeosetAnimInfos(geoset.Anims) + generateIntProp("MaterialID", geoset.MaterialID) + generateIntProp("SelectionGroup", geoset.SelectionGroup) + (geoset.Unselectable ? generateBooleanProp("Unselectable") : "") + middle + generateBlockEnd();
}
function generateGeosetArray(name, arr, elemLength) {
	let middle = "";
	const elemCount = arr.length / elemLength;
	for (let i = 0; i < elemCount; ++i) middle += generateTab(2) + generateArray(arr.slice(i * elemLength, (i + 1) * elemLength)) + ",\n";
	return generateBlockStart(name, elemCount, 1) + middle + generateBlockEnd(1);
}
function generateGeosetVertexGroup(arr) {
	if (!arr.length) return "";
	let middle = "";
	for (let i = 0; i < arr.length; ++i) middle += generateTab(2) + arr[i] + ",\n";
	return generateBlockStart("VertexGroup", null, 1) + middle + generateBlockEnd(1);
}
function generateGeosetFaces(arr) {
	return generateBlockStart(`Faces 1 ${arr.length}`, null, 1) + generateBlockStart("Triangles", null, 2) + generateTab(3) + generateUIntArray(arr) + ",\n" + generateBlockEnd(2) + generateBlockEnd(1);
}
function generateGeosetGroups(groups) {
	let totalMatrices = 0;
	let middle = "";
	for (const group of groups) {
		totalMatrices += group.length;
		middle += generateTab(2) + "Matrices " + generateUIntArray(group) + ",\n";
	}
	return generateBlockStart(`Groups ${groups.length} ${totalMatrices}`, null, 1) + middle + generateBlockEnd(1);
}
function generateGeosetAnimInfos(anims) {
	if (!anims) return "";
	return anims.map(generateGeosetAnimInfoChunk).join("");
}
function generateGeosetAnimInfoChunk(anim) {
	return generateBlockStart("Anim", null, 1) + generateFloatArrayProp("MinimumExtent", anim.MinimumExtent, null, 2) + generateFloatArrayProp("MaximumExtent", anim.MaximumExtent, null, 2) + generateFloatPropIfNotEmpty("BoundsRadius", anim.BoundsRadius, 0, null, 2) + generateBlockEnd(1);
}
function generateGeosetAnims$1(model) {
	if (!model.GeosetAnims.length) return "";
	return model.GeosetAnims.map(generateGeosetAnimChunk).join("");
}
function generateColorProp(name, color, isStatic, tabSize = 1) {
	if (color) if (color instanceof Float32Array) {
		if (!isStatic || isNotEmptyVec3(color, 1)) {
			let middle = "";
			for (let i = 2; i >= 0; --i) {
				if (i < 2) middle += ", ";
				middle += generateNumber(color[i]);
			}
			return `${generateTab(tabSize)}${isStatic ? "static " : ""}${name} { ${middle} },\n`;
		}
	} else return generateAnimVectorProp(name, color, null, tabSize, true);
	return "";
}
function generateGeosetAnimChunk(geosetAnim) {
	return generateBlockStart("GeosetAnim") + generateIntProp("GeosetId", geosetAnim.GeosetId) + generateAnimVectorProp("Alpha", geosetAnim.Alpha, 1) + generateColorProp("Color", geosetAnim.Color, true) + (geosetAnim.Flags & GeosetAnimFlags.DropShadow ? generateBooleanProp("DropShadow") : "") + generateBlockEnd();
}
function generateNodeProps(node) {
	return generateIntProp("ObjectId", node.ObjectId) + generateIntPropIfNotEmpty("Parent", node.Parent, null) + generateNodeDontInherit(node.Flags) + (node.Flags & NodeFlags.Billboarded ? generateBooleanProp("Billboarded") : "") + (node.Flags & NodeFlags.BillboardedLockX ? generateBooleanProp("BillboardedLockX") : "") + (node.Flags & NodeFlags.BillboardedLockY ? generateBooleanProp("BillboardedLockY") : "") + (node.Flags & NodeFlags.BillboardedLockZ ? generateBooleanProp("BillboardedLockZ") : "") + (node.Flags & NodeFlags.CameraAnchored ? generateBooleanProp("CameraAnchored") : "") + (node.Translation !== void 0 ? generateAnimVectorProp("Translation", node.Translation) : "") + (node.Rotation !== void 0 ? generateAnimVectorProp("Rotation", node.Rotation) : "") + (node.Scaling !== void 0 ? generateAnimVectorProp("Scaling", node.Scaling) : "");
}
function generateNodeDontInherit(flags) {
	const flagsStrs = [];
	if (flags & NodeFlags.DontInheritTranslation) flagsStrs.push("Translation");
	if (flags & NodeFlags.DontInheritRotation) flagsStrs.push("Rotation");
	if (flags & NodeFlags.DontInheritScaling) flagsStrs.push("Scaling");
	if (!flagsStrs.length) return "";
	return generateTab(1) + "DontInherit { " + flagsStrs.join(", ") + " },\n";
}
function generateBones$1(model) {
	if (!model.Bones.length) return "";
	return model.Bones.map(generateBoneChunk).join("");
}
function generateBoneChunk(bone) {
	return generateBlockStart("Bone", bone.Name) + generateNodeProps(bone) + (bone.GeosetId !== null ? generateIntProp("GeosetId", bone.GeosetId) : generateStringProp("GeosetId", "Multiple")) + (bone.GeosetAnimId !== null ? generateIntProp("GeosetAnimId", bone.GeosetAnimId) : generateStringProp("GeosetAnimId", "None")) + generateBlockEnd();
}
function generateLights$1(model) {
	if (!model.Lights.length) return "";
	return model.Lights.map(generateLightChunk).join("");
}
function generateLightChunk(light) {
	return generateBlockStart("Light", light.Name) + generateNodeProps(light) + generateBooleanProp(generateLightType(light.LightType)) + generateAnimVectorProp("AttenuationStart", light.AttenuationStart) + generateAnimVectorProp("AttenuationEnd", light.AttenuationEnd) + generateColorProp("Color", light.Color, true) + generateAnimVectorProp("Intensity", light.Intensity, null) + generateColorProp("AmbColor", light.AmbColor, true) + generateAnimVectorProp("AmbIntensity", light.AmbIntensity, null) + generateAnimVectorProp("Visibility", light.Visibility, 1) + generateBlockEnd();
}
function generateLightType(lightType) {
	switch (lightType) {
		case LightType.Omnidirectional: return "Omnidirectional";
		case LightType.Directional: return "Directional";
		case LightType.Ambient: return "Ambient";
	}
	return "";
}
function generateHelpers$1(model) {
	return model.Helpers.map(generateHelperChunk).join("");
}
function generateHelperChunk(helper) {
	return generateBlockStart("Helper", helper.Name) + generateNodeProps(helper) + generateBlockEnd();
}
function generateAttachments$1(model) {
	return model.Attachments.map(generateAttachmentChunk).join("");
}
function generateAttachmentChunk(attachment) {
	return generateBlockStart("Attachment", attachment.Name) + generateNodeProps(attachment) + generateIntProp("AttachmentID", attachment.AttachmentID) + (attachment.Path ? generateWrappedStringProp("Path", attachment.Path) : "") + generateAnimVectorProp("Visibility", attachment.Visibility, 1) + generateBlockEnd();
}
function generatePivotPoints$1(model) {
	return generateBlockStart("PivotPoints", model.PivotPoints.length) + model.PivotPoints.map((point) => `${generateTab()}${generateArray(point)},\n`).join("") + generateBlockEnd();
}
function generateParticleEmitters$1(model) {
	return model.ParticleEmitters.map(generateParticleEmitterChunk).join("");
}
function generateParticleEmitterChunk(emitter) {
	return generateBlockStart("ParticleEmitter", emitter.Name) + generateNodeProps(emitter) + (emitter.Flags & ParticleEmitterFlags.EmitterUsesMDL ? generateBooleanProp("EmitterUsesMDL") : "") + (emitter.Flags & ParticleEmitterFlags.EmitterUsesTGA ? generateBooleanProp("EmitterUsesTGA") : "") + generateAnimVectorProp("EmissionRate", emitter.EmissionRate) + generateAnimVectorProp("Gravity", emitter.Gravity) + generateAnimVectorProp("Longitude", emitter.Longitude) + generateAnimVectorProp("Latitude", emitter.Latitude) + generateAnimVectorProp("Visibility", emitter.Visibility) + generateBlockStart("Particle", null, 1) + generateAnimVectorProp("LifeSpan", emitter.LifeSpan, null, 2) + generateAnimVectorProp("InitVelocity", emitter.InitVelocity, null, 2) + generateWrappedStringProp("Path", emitter.Path, false, 2) + generateBlockEnd(1) + generateBlockEnd();
}
function generateParticleEmitters2$1(model) {
	return model.ParticleEmitters2.map(generateParticleEmitter2Chunk).join("");
}
function generateParticleEmitters2FilterMode(filterMode) {
	switch (filterMode) {
		case ParticleEmitter2FilterMode.Blend: return "Blend";
		case ParticleEmitter2FilterMode.Additive: return "Additive";
		case ParticleEmitter2FilterMode.Modulate: return "Modulate";
		case ParticleEmitter2FilterMode.Modulate2x: return "Modulate2x";
		case ParticleEmitter2FilterMode.AlphaKey: return "AlphaKey";
	}
	return "";
}
function generateSegmentColor(colors) {
	return generateBlockStart("SegmentColor", null, 1) + colors.map((color) => generateColorProp("Color", color, false, 2)).join("") + generateTab() + "},\n";
}
function generateParticleEmitter2FrameFlags(frameFlags) {
	if (frameFlags & ParticleEmitter2FramesFlags.Head && frameFlags & ParticleEmitter2FramesFlags.Tail) return "Both";
	else if (frameFlags & ParticleEmitter2FramesFlags.Head) return "Head";
	else if (frameFlags & ParticleEmitter2FramesFlags.Tail) return "Tail";
	return "";
}
function generateParticleEmitter2Chunk(particleEmitter2) {
	return generateBlockStart("ParticleEmitter2", particleEmitter2.Name) + generateNodeProps(particleEmitter2) + generateBooleanProp(generateParticleEmitters2FilterMode(particleEmitter2.FilterMode)) + generateAnimVectorProp("Speed", particleEmitter2.Speed, null) + generateAnimVectorProp("Variation", particleEmitter2.Variation, null) + generateAnimVectorProp("Latitude", particleEmitter2.Latitude, null) + generateAnimVectorProp("Gravity", particleEmitter2.Gravity, null) + generateAnimVectorProp("EmissionRate", particleEmitter2.EmissionRate, null) + generateAnimVectorProp("Width", particleEmitter2.Width, null) + generateAnimVectorProp("Length", particleEmitter2.Length, null) + generateAnimVectorProp("Visibility", particleEmitter2.Visibility, 1) + generateSegmentColor(particleEmitter2.SegmentColor) + generateUIntArrayProp("Alpha", particleEmitter2.Alpha) + generateFloatArrayProp("ParticleScaling", particleEmitter2.ParticleScaling) + generateFloatArrayProp("LifeSpanUVAnim", particleEmitter2.LifeSpanUVAnim) + generateFloatArrayProp("DecayUVAnim", particleEmitter2.DecayUVAnim) + generateFloatArrayProp("TailUVAnim", particleEmitter2.TailUVAnim) + generateFloatArrayProp("TailDecayUVAnim", particleEmitter2.TailDecayUVAnim) + generateIntPropIfNotEmpty("Rows", particleEmitter2.Rows, 0) + generateIntPropIfNotEmpty("Columns", particleEmitter2.Columns, 0) + generateIntProp("TextureID", particleEmitter2.TextureID) + generateIntPropIfNotEmpty("Time", particleEmitter2.Time, 0) + generateIntPropIfNotEmpty("LifeSpan", particleEmitter2.LifeSpan, 0) + generateIntPropIfNotEmpty("TailLength", particleEmitter2.TailLength, 0) + generateIntPropIfNotEmpty("PriorityPlane", particleEmitter2.PriorityPlane, 0) + generateIntPropIfNotEmpty("ReplaceableId", particleEmitter2.ReplaceableId, null) + (particleEmitter2.Flags & ParticleEmitter2Flags.SortPrimsFarZ ? generateBooleanProp("SortPrimsFarZ") : "") + (particleEmitter2.Flags & ParticleEmitter2Flags.LineEmitter ? generateBooleanProp("LineEmitter") : "") + (particleEmitter2.Flags & ParticleEmitter2Flags.ModelSpace ? generateBooleanProp("ModelSpace") : "") + (particleEmitter2.Flags & ParticleEmitter2Flags.Unshaded ? generateBooleanProp("Unshaded") : "") + (particleEmitter2.Flags & ParticleEmitter2Flags.Unfogged ? generateBooleanProp("Unfogged") : "") + (particleEmitter2.Flags & ParticleEmitter2Flags.XYQuad ? generateBooleanProp("XYQuad") : "") + (particleEmitter2.Squirt ? generateBooleanProp("Squirt") : "") + generateBooleanProp(generateParticleEmitter2FrameFlags(particleEmitter2.FrameFlags)) + generateBlockEnd();
}
function generateRibbonEmitters$1(model) {
	return model.RibbonEmitters.map(generateRibbonEmitterChunk).join("");
}
function generateRibbonEmitterChunk(ribbonEmitter) {
	return generateBlockStart("RibbonEmitter", ribbonEmitter.Name) + generateNodeProps(ribbonEmitter) + generateAnimVectorProp("HeightAbove", ribbonEmitter.HeightAbove, null) + generateAnimVectorProp("HeightBelow", ribbonEmitter.HeightBelow, null) + generateAnimVectorProp("Alpha", ribbonEmitter.Alpha, null) + generateColorProp("Color", ribbonEmitter.Color, true) + generateAnimVectorProp("TextureSlot", ribbonEmitter.TextureSlot, null) + generateAnimVectorProp("Visibility", ribbonEmitter.Visibility, 1) + generateIntProp("EmissionRate", ribbonEmitter.EmissionRate) + generateIntProp("LifeSpan", ribbonEmitter.LifeSpan) + generateIntPropIfNotEmpty("Gravity", ribbonEmitter.Gravity, 0) + generateIntProp("Rows", ribbonEmitter.Rows) + generateIntProp("Columns", ribbonEmitter.Columns) + generateIntProp("MaterialID", ribbonEmitter.MaterialID) + generateBlockEnd();
}
function generateEventObjects$1(model) {
	return model.EventObjects.map(generateEventObjectChunk).join("");
}
function generateEventTrack(eventTrack) {
	let middle = "";
	for (let i = 0; i < eventTrack.length; ++i) middle += generateTab(2) + eventTrack[i] + ",\n";
	return generateBlockStart("EventTrack", eventTrack.length, 1) + middle + generateBlockEnd(1);
}
function generateEventObjectChunk(eventObject) {
	return generateBlockStart("EventObject", eventObject.Name) + generateNodeProps(eventObject) + generateEventTrack(eventObject.EventTrack) + generateBlockEnd();
}
function generateCameras$1(model) {
	return model.Cameras.map(generateCameraChunk).join("");
}
function generateCameraChunk(camera) {
	return generateBlockStart("Camera", camera.Name) + generateFloatProp("FieldOfView", camera.FieldOfView) + generateFloatProp("FarClip", camera.FarClip) + generateFloatProp("NearClip", camera.NearClip) + generateFloatArrayProp("Position", camera.Position) + generateAnimVectorProp("Translation", camera.Translation) + generateAnimVectorProp("Rotation", camera.Rotation) + generateBlockStart("Target", null, 1) + generateFloatArrayProp("Position", camera.TargetPosition, null, 2) + generateAnimVectorProp("Translation", camera.TargetTranslation, null, 2) + generateBlockEnd(1) + generateBlockEnd();
}
function generateCollisionShapes$1(model) {
	return model.CollisionShapes.map(generateCollisionShapeChunk).join("");
}
function generateCollisionShapeChunk(collisionShape) {
	let middle;
	if (collisionShape.Shape === CollisionShapeType.Box) {
		middle = generateBooleanProp("Box");
		middle += generateBlockStart("Vertices", 2, 1) + generateTab(2) + generateArray(collisionShape.Vertices.slice(0, 3)) + ",\n" + generateTab(2) + generateArray(collisionShape.Vertices.slice(3, 6)) + ",\n" + generateBlockEnd(1);
	} else {
		middle = generateBooleanProp("Sphere");
		middle += generateBlockStart("Vertices", 1, 1) + generateTab(2) + generateArray(collisionShape.Vertices) + ",\n" + generateBlockEnd(1) + generateFloatProp("BoundsRadius", collisionShape.BoundsRadius);
	}
	return generateBlockStart("CollisionShape", collisionShape.Name) + generateNodeProps(collisionShape) + middle + generateBlockEnd();
}
function generateFaceFX$1(model) {
	if (model.Version < 900 || !model.FaceFX) return "";
	return model.FaceFX.map(generateFaceFXChunk).join("");
}
function generateFaceFXChunk(faceFX) {
	return generateBlockStart("FaceFX", faceFX.Name) + generateWrappedStringProp("Path", faceFX.Path) + generateBlockEnd();
}
function generateBindPose(model) {
	if (model.Version < 900 || !model.BindPoses) return "";
	return model.BindPoses.map(generateBindPoseChunk).join("");
}
function generateBindPoseChunk(bindPose) {
	const middle = generateBlockStart("Matrices", bindPose.Matrices.length, 1) + bindPose.Matrices.map((item) => {
		return generateTab(2) + generateArray(item) + ",";
	}).join("\n") + "\n" + generateBlockEnd(1);
	return generateBlockStart("BindPose") + middle + generateBlockEnd();
}
function generateParticleEmitterPopcorn(model) {
	if (model.Version < 900 || !model.ParticleEmitterPopcorns) return "";
	return model.ParticleEmitterPopcorns.map(generateParticleEmitterPopcornChunk).join("");
}
function generateParticleEmitterPopcornChunk(emitter) {
	return generateBlockStart("ParticleEmitterPopcorn", emitter.Name) + generateNodeProps(emitter) + (emitter.Flags & ParticleEmitterPopcornFlags.Unshaded ? generateBooleanProp("Unshaded") : "") + (emitter.Flags & ParticleEmitterPopcornFlags.SortPrimsFarZ ? generateBooleanProp("SortPrimsFarZ") : "") + (emitter.Flags & ParticleEmitterPopcornFlags.Unfogged ? generateBooleanProp("Unfogged") : "") + generateAnimVectorProp("LifeSpan", emitter.LifeSpan, null) + generateAnimVectorProp("EmissionRate", emitter.EmissionRate, 0) + generateAnimVectorProp("Speed", emitter.Speed, 0) + generateColorProp("Color", emitter.Color, true) + generateAnimVectorProp("Alpha", emitter.Alpha, 1) + generateIntPropIfNotEmpty("ReplaceableId", emitter.ReplaceableId, 0, null) + generateWrappedStringProp("Path", emitter.Path, false) + generateWrappedStringProp("AnimVisibilityGuide", emitter.AnimVisibilityGuide, false) + generateAnimVectorProp("Visibility", emitter.Visibility) + generateBlockEnd();
}
var generators$1 = [
	generateVersion$1,
	generateModel,
	generateSequences$1,
	generateGlobalSequences$1,
	generateTextures$1,
	generateMaterials$1,
	generateTextureAnims$1,
	generateGeosets$1,
	generateGeosetAnims$1,
	generateBones$1,
	generateLights$1,
	generateHelpers$1,
	generateAttachments$1,
	generatePivotPoints$1,
	generateParticleEmitters$1,
	generateParticleEmitters2$1,
	generateRibbonEmitters$1,
	generateEventObjects$1,
	generateCameras$1,
	generateCollisionShapes$1,
	generateFaceFX$1,
	generateBindPose,
	generateParticleEmitterPopcorn
];
function generate(model) {
	let res = "";
	for (const generator of generators$1) res += generator(model);
	return res;
}
//#endregion
//#region mdx/generate.ts
var BIG_ENDIAN = true;
var NONE = -1;
var Stream = class {
	constructor(arrayBuffer) {
		this.ab = arrayBuffer;
		this.uint = new Uint8Array(this.ab);
		this.view = new DataView(this.ab);
		this.pos = 0;
	}
	keyword(keyword) {
		this.uint[this.pos] = keyword.charCodeAt(0);
		this.uint[this.pos + 1] = keyword.charCodeAt(1);
		this.uint[this.pos + 2] = keyword.charCodeAt(2);
		this.uint[this.pos + 3] = keyword.charCodeAt(3);
		this.pos += 4;
	}
	uint8(num) {
		this.view.setUint8(this.pos, num);
		this.pos += 1;
	}
	uint16(num) {
		this.view.setUint16(this.pos, num, BIG_ENDIAN);
		this.pos += 2;
	}
	int32(num) {
		this.view.setInt32(this.pos, num, BIG_ENDIAN);
		this.pos += 4;
	}
	uint32(num) {
		this.view.setUint32(this.pos, num, BIG_ENDIAN);
		this.pos += 4;
	}
	float32(num) {
		this.view.setFloat32(this.pos, num, BIG_ENDIAN);
		this.pos += 4;
	}
	float32Array(arr) {
		for (let i = 0; i < arr.length; ++i) this.float32(arr[i]);
	}
	uint8Array(arr) {
		for (let i = 0; i < arr.length; ++i) this.uint8(arr[i]);
	}
	uint16Array(arr) {
		for (let i = 0; i < arr.length; ++i) this.uint16(arr[i]);
	}
	int32Array(arr) {
		for (let i = 0; i < arr.length; ++i) this.int32(arr[i]);
	}
	uint32Array(arr) {
		for (let i = 0; i < arr.length; ++i) this.uint32(arr[i]);
	}
	str(str, len) {
		for (let i = 0; i < len; ++i, ++this.pos) this.uint[this.pos] = i < str.length ? str.charCodeAt(i) : 0;
	}
	animVector(animVector, type) {
		const isInt = type === AnimVectorType.INT1;
		this.int32(animVector.Keys.length);
		this.int32(animVector.LineType);
		this.int32(animVector.GlobalSeqId !== null ? animVector.GlobalSeqId : NONE);
		for (const keyFrame of animVector.Keys) {
			this.int32(keyFrame.Frame);
			if (isInt) this.int32Array(keyFrame.Vector);
			else this.float32Array(keyFrame.Vector);
			if (animVector.LineType === LineType.Hermite || animVector.LineType === LineType.Bezier) if (isInt) {
				this.int32Array(keyFrame.InTan);
				this.int32Array(keyFrame.OutTan);
			} else {
				this.float32Array(keyFrame.InTan);
				this.float32Array(keyFrame.OutTan);
			}
		}
	}
};
function generateExtent(obj, stream) {
	stream.float32(obj.BoundsRadius || 0);
	for (const key of ["MinimumExtent", "MaximumExtent"]) stream.float32Array(obj[key]);
}
var AnimVectorType = /* @__PURE__ */ function(AnimVectorType) {
	AnimVectorType[AnimVectorType["INT1"] = 0] = "INT1";
	AnimVectorType[AnimVectorType["FLOAT1"] = 1] = "FLOAT1";
	AnimVectorType[AnimVectorType["FLOAT3"] = 2] = "FLOAT3";
	AnimVectorType[AnimVectorType["FLOAT4"] = 3] = "FLOAT4";
	return AnimVectorType;
}(AnimVectorType || {});
var animVectorSize = {
	[AnimVectorType.INT1]: 1,
	[AnimVectorType.FLOAT1]: 1,
	[AnimVectorType.FLOAT3]: 3,
	[AnimVectorType.FLOAT4]: 4
};
function byteLengthAnimVector(animVector, type) {
	return 12 + animVector.Keys.length * (4 + 4 * animVectorSize[type] * (animVector.LineType === LineType.Hermite || animVector.LineType === LineType.Bezier ? 3 : 1));
}
function sum(arr) {
	return arr.reduce((a, b) => {
		return a + b;
	}, 0);
}
function byteLengthVersion() {
	return 12;
}
function generateVersion(model, stream) {
	stream.keyword("VERS");
	stream.int32(4);
	stream.int32(model.Version);
}
var MODEL_NAME_LENGTH = 336;
function byteLengthModelInfo() {
	return 8 + MODEL_NAME_LENGTH + 4 + 28 + 4;
}
function generateModelInfo(model, stream) {
	stream.keyword("MODL");
	stream.int32(byteLengthModelInfo() - 8);
	stream.str(model.Info.Name, MODEL_NAME_LENGTH);
	stream.int32(0);
	generateExtent(model.Info, stream);
	stream.int32(model.Info.BlendTime);
}
var MODEL_SEQUENCE_NAME_LENGTH = 80;
function byteLengthSequence() {
	return MODEL_SEQUENCE_NAME_LENGTH + 8 + 4 + 4 + 4 + 4 + 28;
}
function byteLengthSequences(model) {
	if (!model.Sequences.length) return 0;
	return 8 + sum(model.Sequences.map(byteLengthSequence));
}
function generateSequences(model, stream) {
	if (!model.Sequences.length) return;
	stream.keyword("SEQS");
	stream.int32(byteLengthSequences(model) - 8);
	for (const sequence of model.Sequences) {
		stream.str(sequence.Name, MODEL_SEQUENCE_NAME_LENGTH);
		stream.int32(sequence.Interval[0]);
		stream.int32(sequence.Interval[1]);
		stream.float32(sequence.MoveSpeed);
		stream.int32(sequence.NonLooping ? 1 : 0);
		stream.float32(sequence.Rarity);
		stream.int32(0);
		generateExtent(sequence, stream);
	}
}
function byteLengthGlobalSequences(model) {
	if (!model.GlobalSequences || !model.GlobalSequences.length) return 0;
	return 8 + 4 * model.GlobalSequences.length;
}
function generateGlobalSequences(model, stream) {
	if (!model.GlobalSequences || !model.GlobalSequences.length) return;
	stream.keyword("GLBS");
	stream.int32(model.GlobalSequences.length * 4);
	for (const duration of model.GlobalSequences) stream.int32(duration);
}
function byteLengthLayer(model, layer) {
	return 28 + (model.Version >= 900 ? 4 : 0) + (model.Version >= 1e3 ? 20 : 0) + (model.Version >= 1100 ? 8 + LAYER_TEXTURE_ID_MAP.reduce((acc, name) => {
		return acc + (typeof layer[name] !== "undefined" ? 8 + (typeof layer[name] === "object" ? 4 + byteLengthAnimVector(layer[name], AnimVectorType.INT1) : 0) : 0);
	}, 0) : 0) + (layer.Alpha !== null && typeof layer.Alpha !== "number" ? 4 + byteLengthAnimVector(layer.Alpha, AnimVectorType.FLOAT1) : 0) + (model.Version < 1100 && layer.TextureID !== null && typeof layer.TextureID !== "number" ? 4 + byteLengthAnimVector(layer.TextureID, AnimVectorType.INT1) : 0) + (model.Version >= 900 && layer.EmissiveGain !== void 0 && layer.EmissiveGain !== null && typeof layer.EmissiveGain !== "number" ? 4 + byteLengthAnimVector(layer.EmissiveGain, AnimVectorType.FLOAT1) : 0) + (model.Version >= 1e3 && layer.FresnelColor !== void 0 && layer.FresnelColor !== null && !(layer.FresnelColor instanceof Float32Array) ? 4 + byteLengthAnimVector(layer.FresnelColor, AnimVectorType.FLOAT3) : 0) + (model.Version >= 1e3 && layer.FresnelOpacity !== void 0 && layer.FresnelOpacity !== null && typeof layer.FresnelOpacity !== "number" ? 4 + byteLengthAnimVector(layer.FresnelOpacity, AnimVectorType.FLOAT1) : 0) + (model.Version >= 1e3 && layer.FresnelTeamColor !== void 0 && layer.FresnelTeamColor !== null && typeof layer.FresnelTeamColor !== "number" ? 4 + byteLengthAnimVector(layer.FresnelTeamColor, AnimVectorType.FLOAT1) : 0);
}
function byteLengthMaterial(model, material) {
	return 20 + (model.Version >= 900 && model.Version < 1100 ? 80 : 0) + sum(material.Layers.map((layer) => byteLengthLayer(model, layer)));
}
function byteLengthMaterials(model) {
	if (!model.Materials.length) return 0;
	return 8 + sum(model.Materials.map((material) => byteLengthMaterial(model, material)));
}
function generateMaterials(model, stream) {
	if (!model.Materials.length) return;
	stream.keyword("MTLS");
	stream.int32(byteLengthMaterials(model) - 8);
	for (const material of model.Materials) {
		stream.int32(byteLengthMaterial(model, material));
		stream.int32(material.PriorityPlane);
		stream.int32(material.RenderMode);
		if (model.Version >= 900 && model.Version < 1100) stream.str(material.Shader || "", 80);
		stream.keyword("LAYS");
		stream.int32(material.Layers.length);
		for (const layer of material.Layers) {
			stream.int32(byteLengthLayer(model, layer));
			stream.int32(layer.FilterMode);
			stream.int32(layer.Shading);
			stream.int32(model.Version < 1100 && typeof layer.TextureID === "number" ? layer.TextureID : 0);
			stream.int32(layer.TVertexAnimId !== null ? layer.TVertexAnimId : NONE);
			stream.int32(layer.CoordId);
			stream.float32(typeof layer.Alpha === "number" ? layer.Alpha : 1);
			if (model.Version >= 900) {
				stream.float32(typeof layer.EmissiveGain === "number" ? layer.EmissiveGain : 1);
				if (model.Version >= 1e3) {
					stream.float32Array(layer.FresnelColor instanceof Float32Array ? layer.FresnelColor : new Float32Array([
						1,
						1,
						1
					]));
					stream.float32(typeof layer.FresnelOpacity === "number" ? layer.FresnelOpacity : 0);
					stream.float32(typeof layer.FresnelTeamColor === "number" ? layer.FresnelTeamColor : 0);
				}
			}
			if (model.Version >= 1100) {
				stream.int32(layer.ShaderTypeId || 0);
				const textures = LAYER_TEXTURE_ID_MAP.filter((name) => layer[name] !== void 0).length;
				stream.int32(textures);
				for (let i = 0; i < LAYER_TEXTURE_ID_MAP.length; ++i) {
					const id = layer[LAYER_TEXTURE_ID_MAP[i]];
					if (id === void 0) continue;
					stream.int32(typeof id === "number" ? id : 0);
					stream.int32(typeof id === "number" ? i : 0);
					if (typeof id === "object") {
						stream.keyword("KMTF");
						stream.animVector(id, AnimVectorType.INT1);
					}
				}
			}
			if (layer.Alpha && typeof layer.Alpha !== "number") {
				stream.keyword("KMTA");
				stream.animVector(layer.Alpha, AnimVectorType.FLOAT1);
			}
			if (model.Version < 1100 && layer.TextureID && typeof layer.TextureID !== "number") {
				stream.keyword("KMTF");
				stream.animVector(layer.TextureID, AnimVectorType.INT1);
			}
			if (model.Version >= 900 && layer.EmissiveGain && typeof layer.EmissiveGain !== "number") {
				stream.keyword("KMTE");
				stream.animVector(layer.EmissiveGain, AnimVectorType.FLOAT1);
			}
			if (model.Version >= 1e3 && layer.FresnelColor && !(layer.FresnelColor instanceof Float32Array)) {
				stream.keyword("KFC3");
				stream.animVector(layer.FresnelColor, AnimVectorType.FLOAT3);
			}
			if (model.Version >= 1e3 && layer.FresnelOpacity && typeof layer.FresnelOpacity !== "number") {
				stream.keyword("KFCA");
				stream.animVector(layer.FresnelOpacity, AnimVectorType.FLOAT1);
			}
			if (model.Version >= 1e3 && layer.FresnelTeamColor && typeof layer.FresnelTeamColor !== "number") {
				stream.keyword("KFTC");
				stream.animVector(layer.FresnelTeamColor, AnimVectorType.FLOAT1);
			}
		}
	}
}
var MODEL_TEXTURE_PATH_LENGTH = 256;
function byteLengthTexture() {
	return 4 + MODEL_TEXTURE_PATH_LENGTH + 4 + 4;
}
function byteLengthTextures(model) {
	if (!model.Textures.length) return 0;
	return 8 + sum(model.Textures.map((_texture) => byteLengthTexture()));
}
function generateTextures(model, stream) {
	if (!model.Textures.length) return;
	stream.keyword("TEXS");
	stream.int32(byteLengthTextures(model) - 8);
	for (const texture of model.Textures) {
		stream.int32(texture.ReplaceableId);
		stream.str(texture.Image, MODEL_TEXTURE_PATH_LENGTH);
		stream.int32(0);
		stream.int32(texture.Flags);
	}
}
function byteLengthTextureAnim(anim) {
	return 4 + (anim.Translation ? 4 + byteLengthAnimVector(anim.Translation, AnimVectorType.FLOAT3) : 0) + (anim.Rotation ? 4 + byteLengthAnimVector(anim.Rotation, AnimVectorType.FLOAT4) : 0) + (anim.Scaling ? 4 + byteLengthAnimVector(anim.Scaling, AnimVectorType.FLOAT3) : 0);
}
function byteLengthTextureAnims(model) {
	if (!model.TextureAnims || !model.TextureAnims.length) return 0;
	return 8 + sum(model.TextureAnims.map((anim) => byteLengthTextureAnim(anim)));
}
function generateTextureAnims(model, stream) {
	if (!model.TextureAnims || !model.TextureAnims.length) return;
	stream.keyword("TXAN");
	stream.int32(byteLengthTextureAnims(model) - 8);
	for (const anim of model.TextureAnims) {
		stream.int32(byteLengthTextureAnim(anim));
		if (anim.Translation) {
			stream.keyword("KTAT");
			stream.animVector(anim.Translation, AnimVectorType.FLOAT3);
		}
		if (anim.Rotation) {
			stream.keyword("KTAR");
			stream.animVector(anim.Rotation, AnimVectorType.FLOAT4);
		}
		if (anim.Scaling) {
			stream.keyword("KTAS");
			stream.animVector(anim.Scaling, AnimVectorType.FLOAT3);
		}
	}
}
function byteLengthGeoset(model, geoset) {
	return 12 + 4 * geoset.Vertices.length + 4 + 4 + 4 * geoset.Normals.length + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 2 * geoset.Faces.length + 4 + 4 + geoset.VertexGroup.length + 4 + 4 + 4 * geoset.Groups.length + 4 + 4 + 4 * geoset.TotalGroupsCount + 4 + 4 + 4 + (model.Version >= 900 ? 84 : 0) + (model.Version >= 900 && geoset.Tangents?.length ? 8 + 4 * geoset.Tangents.length : 0) + (model.Version >= 900 && geoset.SkinWeights?.length ? 8 + geoset.SkinWeights.length : 0) + 28 + 4 + 28 * geoset.Anims.length + 4 + 4 + sum(geoset.TVertices.map((tvertices) => 8 + 4 * tvertices.length));
}
function byteLengthGeosets(model) {
	if (!model.Geosets.length) return 0;
	return 8 + sum(model.Geosets.map((geoset) => byteLengthGeoset(model, geoset)));
}
function generateGeosets(model, stream) {
	if (!model.Geosets.length) return;
	stream.keyword("GEOS");
	stream.int32(byteLengthGeosets(model) - 8);
	for (const geoset of model.Geosets) {
		stream.int32(byteLengthGeoset(model, geoset));
		stream.keyword("VRTX");
		stream.int32(geoset.Vertices.length / 3);
		stream.float32Array(geoset.Vertices);
		stream.keyword("NRMS");
		stream.int32(geoset.Normals.length / 3);
		stream.float32Array(geoset.Normals);
		stream.keyword("PTYP");
		stream.int32(1);
		stream.int32(4);
		stream.keyword("PCNT");
		stream.int32(1);
		stream.int32(geoset.Faces.length);
		stream.keyword("PVTX");
		stream.int32(geoset.Faces.length);
		stream.uint16Array(geoset.Faces);
		stream.keyword("GNDX");
		stream.int32(geoset.VertexGroup.length);
		stream.uint8Array(geoset.VertexGroup);
		stream.keyword("MTGC");
		stream.int32(geoset.Groups.length);
		for (let i = 0; i < geoset.Groups.length; ++i) stream.int32(geoset.Groups[i].length);
		stream.keyword("MATS");
		stream.int32(geoset.TotalGroupsCount);
		for (const group of geoset.Groups) for (const index of group) stream.int32(index);
		stream.int32(geoset.MaterialID);
		stream.int32(geoset.SelectionGroup);
		stream.int32(geoset.Unselectable ? 4 : 0);
		if (model.Version >= 900) {
			stream.int32(typeof geoset.LevelOfDetail === "number" ? geoset.LevelOfDetail : -1);
			stream.str(geoset.Name || "", 80);
		}
		generateExtent(geoset, stream);
		stream.int32(geoset.Anims.length);
		for (const anim of geoset.Anims) generateExtent(anim, stream);
		if (model.Version >= 900) {
			if (geoset.Tangents && geoset.Tangents.length) {
				stream.keyword("TANG");
				stream.int32(geoset.Tangents.length / 4);
				stream.float32Array(geoset.Tangents);
			}
			if (geoset.SkinWeights && geoset.SkinWeights.length) {
				stream.keyword("SKIN");
				stream.int32(geoset.SkinWeights.length);
				stream.uint8Array(geoset.SkinWeights);
			}
		}
		stream.keyword("UVAS");
		stream.int32(geoset.TVertices.length);
		for (const tvertices of geoset.TVertices) {
			stream.keyword("UVBS");
			stream.int32(tvertices.length / 2);
			stream.float32Array(tvertices);
		}
	}
}
function byteLengthGeosetAnim(anim) {
	return 28 + (typeof anim.Alpha !== "number" ? 4 + byteLengthAnimVector(anim.Alpha, AnimVectorType.FLOAT1) : 0) + (anim.Color && !(anim.Color instanceof Float32Array) ? 4 + byteLengthAnimVector(anim.Color, AnimVectorType.FLOAT3) : 0);
}
function byteLengthGeosetAnims(model) {
	if (!model.GeosetAnims.length) return 0;
	return 8 + sum(model.GeosetAnims.map((anim) => byteLengthGeosetAnim(anim)));
}
function generateGeosetAnims(model, stream) {
	if (!model.GeosetAnims.length) return;
	stream.keyword("GEOA");
	stream.int32(byteLengthGeosetAnims(model) - 8);
	for (const anim of model.GeosetAnims) {
		stream.int32(byteLengthGeosetAnim(anim));
		stream.float32(typeof anim.Alpha === "number" ? anim.Alpha : 1);
		stream.int32(anim.Flags);
		if (anim.Color && anim.Color instanceof Float32Array) {
			stream.float32(anim.Color[0]);
			stream.float32(anim.Color[1]);
			stream.float32(anim.Color[2]);
		} else {
			stream.float32(1);
			stream.float32(1);
			stream.float32(1);
		}
		stream.int32(anim.GeosetId !== null ? anim.GeosetId : NONE);
		if (anim.Alpha !== null && typeof anim.Alpha !== "number") {
			stream.keyword("KGAO");
			stream.animVector(anim.Alpha, AnimVectorType.FLOAT1);
		}
		if (anim.Color && !(anim.Color instanceof Float32Array)) {
			stream.keyword("KGAC");
			stream.animVector(anim.Color, AnimVectorType.FLOAT3);
		}
	}
}
var MODEL_NODE_NAME_LENGTH = 80;
function byteLengthNode(node) {
	return 4 + MODEL_NODE_NAME_LENGTH + 4 + 4 + 4 + (node.Translation ? 4 + byteLengthAnimVector(node.Translation, AnimVectorType.FLOAT3) : 0) + (node.Rotation ? 4 + byteLengthAnimVector(node.Rotation, AnimVectorType.FLOAT4) : 0) + (node.Scaling ? 4 + byteLengthAnimVector(node.Scaling, AnimVectorType.FLOAT3) : 0);
}
function byteLengthBone(bone) {
	return byteLengthNode(bone) + 4 + 4;
}
function byteLengthBones(model) {
	if (!model.Bones.length) return 0;
	return 8 + sum(model.Bones.map(byteLengthBone));
}
function generateNode(node, stream) {
	stream.int32(byteLengthNode(node));
	stream.str(node.Name, MODEL_NODE_NAME_LENGTH);
	stream.int32(node.ObjectId !== null ? node.ObjectId : NONE);
	stream.int32(node.Parent !== null ? node.Parent : NONE);
	stream.int32(node.Flags);
	if (node.Translation) {
		stream.keyword("KGTR");
		stream.animVector(node.Translation, AnimVectorType.FLOAT3);
	}
	if (node.Rotation) {
		stream.keyword("KGRT");
		stream.animVector(node.Rotation, AnimVectorType.FLOAT4);
	}
	if (node.Scaling) {
		stream.keyword("KGSC");
		stream.animVector(node.Scaling, AnimVectorType.FLOAT3);
	}
}
function generateBones(model, stream) {
	if (!model.Bones.length) return;
	stream.keyword("BONE");
	stream.int32(byteLengthBones(model) - 8);
	for (const bone of model.Bones) {
		generateNode(bone, stream);
		stream.int32(bone.GeosetId !== null ? bone.GeosetId : NONE);
		stream.int32(bone.GeosetAnimId !== null ? bone.GeosetAnimId : NONE);
	}
}
function byteLengthLight(light) {
	return 4 + byteLengthNode(light) + 4 + 4 + 4 + 12 + 4 + 12 + 4 + (light.Visibility ? 4 + byteLengthAnimVector(light.Visibility, AnimVectorType.FLOAT1) : 0) + (light.Color && !(light.Color instanceof Float32Array) ? 4 + byteLengthAnimVector(light.Color, AnimVectorType.FLOAT3) : 0) + (light.Intensity && typeof light.Intensity !== "number" ? 4 + byteLengthAnimVector(light.Intensity, AnimVectorType.FLOAT1) : 0) + (light.AttenuationStart && typeof light.AttenuationStart !== "number" ? 4 + byteLengthAnimVector(light.AttenuationStart, AnimVectorType.FLOAT1) : 0) + (light.AttenuationEnd && typeof light.AttenuationEnd !== "number" ? 4 + byteLengthAnimVector(light.AttenuationEnd, AnimVectorType.FLOAT1) : 0) + (light.AmbColor && !(light.AmbColor instanceof Float32Array) ? 4 + byteLengthAnimVector(light.AmbColor, AnimVectorType.FLOAT3) : 0) + (light.AmbIntensity && typeof light.AmbIntensity !== "number" ? 4 + byteLengthAnimVector(light.AmbIntensity, AnimVectorType.FLOAT1) : 0);
}
function byteLengthLights(model) {
	if (!model.Lights.length) return 0;
	return 8 + sum(model.Lights.map(byteLengthLight));
}
function generateLights(model, stream) {
	if (!model.Lights.length) return;
	stream.keyword("LITE");
	stream.int32(byteLengthLights(model) - 8);
	for (const light of model.Lights) {
		stream.int32(byteLengthLight(light));
		generateNode(light, stream);
		stream.int32(light.LightType);
		stream.float32(typeof light.AttenuationStart === "number" ? light.AttenuationStart : 0);
		stream.float32(typeof light.AttenuationEnd === "number" ? light.AttenuationEnd : 0);
		if (light.Color instanceof Float32Array) {
			stream.float32(light.Color[0]);
			stream.float32(light.Color[1]);
			stream.float32(light.Color[2]);
		} else {
			stream.float32(1);
			stream.float32(1);
			stream.float32(1);
		}
		stream.float32(typeof light.Intensity === "number" ? light.Intensity : 0);
		if (light.AmbColor instanceof Float32Array) {
			stream.float32(light.AmbColor[0]);
			stream.float32(light.AmbColor[1]);
			stream.float32(light.AmbColor[2]);
		} else {
			stream.float32(1);
			stream.float32(1);
			stream.float32(1);
		}
		stream.float32(typeof light.AmbIntensity === "number" ? light.AmbIntensity : 0);
		if (light.Intensity && typeof light.Intensity !== "number") {
			stream.keyword("KLAI");
			stream.animVector(light.Intensity, AnimVectorType.FLOAT1);
		}
		if (light.Visibility) {
			stream.keyword("KLAV");
			stream.animVector(light.Visibility, AnimVectorType.FLOAT1);
		}
		if (light.Color && !(light.Color instanceof Float32Array)) {
			stream.keyword("KLAC");
			stream.animVector(light.Color, AnimVectorType.FLOAT3);
		}
		if (light.AmbColor && !(light.AmbColor instanceof Float32Array)) {
			stream.keyword("KLBC");
			stream.animVector(light.AmbColor, AnimVectorType.FLOAT3);
		}
		if (light.AmbIntensity && typeof light.AmbIntensity !== "number") {
			stream.keyword("KLBI");
			stream.animVector(light.AmbIntensity, AnimVectorType.FLOAT1);
		}
		if (light.AttenuationStart && typeof light.AttenuationStart !== "number") {
			stream.keyword("KLAS");
			stream.animVector(light.AttenuationStart, AnimVectorType.INT1);
		}
		if (light.AttenuationEnd && typeof light.AttenuationEnd !== "number") {
			stream.keyword("KLAE");
			stream.animVector(light.AttenuationEnd, AnimVectorType.INT1);
		}
	}
}
function byteLengthHelpers(model) {
	if (model.Helpers.length === 0) return 0;
	return 8 + sum(model.Helpers.map(byteLengthNode));
}
function generateHelpers(model, stream) {
	if (model.Helpers.length === 0) return;
	stream.keyword("HELP");
	stream.int32(byteLengthHelpers(model) - 8);
	for (const helper of model.Helpers) generateNode(helper, stream);
}
var MODEL_ATTACHMENT_PATH_LENGTH = 256;
function byteLengthAttachment(attachment) {
	return 4 + byteLengthNode(attachment) + MODEL_ATTACHMENT_PATH_LENGTH + 4 + 4 + (attachment.Visibility ? 4 + byteLengthAnimVector(attachment.Visibility, AnimVectorType.FLOAT1) : 0);
}
function byteLengthAttachments(model) {
	if (model.Attachments.length === 0) return 0;
	return 8 + sum(model.Attachments.map(byteLengthAttachment));
}
function generateAttachments(model, stream) {
	if (model.Attachments.length === 0) return;
	stream.keyword("ATCH");
	stream.int32(byteLengthAttachments(model) - 8);
	for (const attachment of model.Attachments) {
		stream.int32(byteLengthAttachment(attachment));
		generateNode(attachment, stream);
		stream.str(attachment.Path || "", MODEL_ATTACHMENT_PATH_LENGTH);
		stream.int32(0);
		stream.int32(attachment.AttachmentID);
		if (attachment.Visibility) {
			stream.keyword("KATV");
			stream.animVector(attachment.Visibility, AnimVectorType.FLOAT1);
		}
	}
}
function byteLengthPivotPoints(model) {
	if (!model.PivotPoints.length) return 0;
	return 8 + 12 * model.PivotPoints.length;
}
function generatePivotPoints(model, stream) {
	if (!model.PivotPoints.length) return;
	stream.keyword("PIVT");
	stream.int32(model.PivotPoints.length * 4 * 3);
	for (const point of model.PivotPoints) stream.float32Array(point);
}
var MODEL_PARTICLE_EMITTER_PATH_LENGTH = 256;
function byteLengthParticleEmitter(emitter) {
	return 4 + byteLengthNode(emitter) + 4 + 4 + 4 + 4 + MODEL_PARTICLE_EMITTER_PATH_LENGTH + 4 + 4 + 4 + (emitter.Visibility && typeof emitter.Visibility !== "number" ? 4 + byteLengthAnimVector(emitter.Visibility, AnimVectorType.FLOAT1) : 0) + (emitter.EmissionRate && typeof emitter.EmissionRate !== "number" ? 4 + byteLengthAnimVector(emitter.EmissionRate, AnimVectorType.FLOAT1) : 0) + (emitter.Gravity && typeof emitter.Gravity !== "number" ? 4 + byteLengthAnimVector(emitter.Gravity, AnimVectorType.FLOAT1) : 0) + (emitter.Longitude && typeof emitter.Longitude !== "number" ? 4 + byteLengthAnimVector(emitter.Longitude, AnimVectorType.FLOAT1) : 0) + (emitter.Latitude && typeof emitter.Latitude !== "number" ? 4 + byteLengthAnimVector(emitter.Latitude, AnimVectorType.FLOAT1) : 0) + (emitter.LifeSpan && typeof emitter.LifeSpan !== "number" ? 4 + byteLengthAnimVector(emitter.LifeSpan, AnimVectorType.FLOAT1) : 0) + (emitter.InitVelocity && typeof emitter.InitVelocity !== "number" ? 4 + byteLengthAnimVector(emitter.InitVelocity, AnimVectorType.FLOAT1) : 0);
}
function byteLengthParticleEmitters(model) {
	if (!model.ParticleEmitters.length) return 0;
	return 8 + sum(model.ParticleEmitters.map(byteLengthParticleEmitter));
}
function generateParticleEmitters(model, stream) {
	if (!model.ParticleEmitters.length) return;
	stream.keyword("PREM");
	stream.int32(byteLengthParticleEmitters(model) - 8);
	for (const emitter of model.ParticleEmitters) {
		stream.int32(byteLengthParticleEmitter(emitter));
		generateNode(emitter, stream);
		stream.float32(typeof emitter.EmissionRate === "number" ? emitter.EmissionRate : 0);
		stream.float32(typeof emitter.Gravity === "number" ? emitter.Gravity : 0);
		stream.float32(typeof emitter.Longitude === "number" ? emitter.Longitude : 0);
		stream.float32(typeof emitter.Latitude === "number" ? emitter.Latitude : 0);
		stream.str(emitter.Path, MODEL_PARTICLE_EMITTER_PATH_LENGTH);
		stream.int32(0);
		stream.float32(typeof emitter.LifeSpan === "number" ? emitter.LifeSpan : 0);
		stream.float32(typeof emitter.InitVelocity === "number" ? emitter.InitVelocity : 0);
		if (emitter.Visibility && typeof emitter.Visibility !== "number") {
			stream.keyword("KPEV");
			stream.animVector(emitter.Visibility, AnimVectorType.FLOAT1);
		}
		if (emitter.EmissionRate && typeof emitter.EmissionRate !== "number") {
			stream.keyword("KPEE");
			stream.animVector(emitter.EmissionRate, AnimVectorType.FLOAT1);
		}
		if (emitter.Gravity && typeof emitter.Gravity !== "number") {
			stream.keyword("KPEG");
			stream.animVector(emitter.Gravity, AnimVectorType.FLOAT1);
		}
		if (emitter.Longitude && typeof emitter.Longitude !== "number") {
			stream.keyword("KPLN");
			stream.animVector(emitter.Longitude, AnimVectorType.FLOAT1);
		}
		if (emitter.Latitude && typeof emitter.Latitude !== "number") {
			stream.keyword("KPLT");
			stream.animVector(emitter.Latitude, AnimVectorType.FLOAT1);
		}
		if (emitter.LifeSpan && typeof emitter.LifeSpan !== "number") {
			stream.keyword("KPEL");
			stream.animVector(emitter.LifeSpan, AnimVectorType.FLOAT1);
		}
		if (emitter.InitVelocity && typeof emitter.InitVelocity !== "number") {
			stream.keyword("KPES");
			stream.animVector(emitter.InitVelocity, AnimVectorType.FLOAT1);
		}
	}
}
function byteLengthParticleEmitter2(emitter) {
	return 4 + byteLengthNode(emitter) + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 36 + 3 + 12 + 12 + 12 + 12 + 12 + 4 + 4 + 4 + 4 + (emitter.Visibility && typeof emitter.Visibility !== "number" ? 4 + byteLengthAnimVector(emitter.Visibility, AnimVectorType.FLOAT1) : 0) + (emitter.EmissionRate && typeof emitter.EmissionRate !== "number" ? 4 + byteLengthAnimVector(emitter.EmissionRate, AnimVectorType.FLOAT1) : 0) + (emitter.Width && typeof emitter.Width !== "number" ? 4 + byteLengthAnimVector(emitter.Width, AnimVectorType.FLOAT1) : 0) + (emitter.Length && typeof emitter.Length !== "number" ? 4 + byteLengthAnimVector(emitter.Length, AnimVectorType.FLOAT1) : 0) + (emitter.Speed && typeof emitter.Speed !== "number" ? 4 + byteLengthAnimVector(emitter.Speed, AnimVectorType.FLOAT1) : 0) + (emitter.Latitude && typeof emitter.Latitude !== "number" ? 4 + byteLengthAnimVector(emitter.Latitude, AnimVectorType.FLOAT1) : 0) + (emitter.Gravity && typeof emitter.Gravity !== "number" ? 4 + byteLengthAnimVector(emitter.Gravity, AnimVectorType.FLOAT1) : 0) + (emitter.Variation && typeof emitter.Variation !== "number" ? 4 + byteLengthAnimVector(emitter.Variation, AnimVectorType.FLOAT1) : 0);
}
function byteLengthParticleEmitters2(model) {
	if (!model.ParticleEmitters2.length) return 0;
	return 8 + sum(model.ParticleEmitters2.map(byteLengthParticleEmitter2));
}
function generateParticleEmitters2(model, stream) {
	if (!model.ParticleEmitters2.length) return;
	stream.keyword("PRE2");
	stream.int32(byteLengthParticleEmitters2(model) - 8);
	for (const emitter of model.ParticleEmitters2) {
		stream.int32(byteLengthParticleEmitter2(emitter));
		generateNode(emitter, stream);
		stream.float32(typeof emitter.Speed === "number" ? emitter.Speed : 0);
		stream.float32(typeof emitter.Variation === "number" ? emitter.Variation : 0);
		stream.float32(typeof emitter.Latitude === "number" ? emitter.Latitude : 0);
		stream.float32(typeof emitter.Gravity === "number" ? emitter.Gravity : 0);
		stream.float32(emitter.LifeSpan);
		stream.float32(typeof emitter.EmissionRate === "number" ? emitter.EmissionRate : 0);
		stream.float32(typeof emitter.Width === "number" ? emitter.Width : 0);
		stream.float32(typeof emitter.Length === "number" ? emitter.Length : 0);
		stream.int32(emitter.FilterMode);
		stream.int32(emitter.Rows);
		stream.int32(emitter.Columns);
		if (emitter.FrameFlags & ParticleEmitter2FramesFlags.Head && emitter.FrameFlags & ParticleEmitter2FramesFlags.Tail) stream.int32(2);
		else if (emitter.FrameFlags & ParticleEmitter2FramesFlags.Tail) stream.int32(1);
		else if (emitter.FrameFlags & ParticleEmitter2FramesFlags.Head) stream.int32(0);
		stream.float32(emitter.TailLength);
		stream.float32(emitter.Time);
		for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) stream.float32(emitter.SegmentColor[i][j]);
		for (let i = 0; i < 3; ++i) stream.uint8(emitter.Alpha[i]);
		for (let i = 0; i < 3; ++i) stream.float32(emitter.ParticleScaling[i]);
		for (const part of [
			"LifeSpanUVAnim",
			"DecayUVAnim",
			"TailUVAnim",
			"TailDecayUVAnim"
		]) for (let i = 0; i < 3; ++i) stream.int32(emitter[part][i]);
		stream.int32(emitter.TextureID !== null ? emitter.TextureID : NONE);
		stream.int32(emitter.Squirt ? 1 : 0);
		stream.int32(emitter.PriorityPlane);
		stream.int32(emitter.ReplaceableId);
		if (emitter.Speed && typeof emitter.Speed !== "number") {
			stream.keyword("KP2S");
			stream.animVector(emitter.Speed, AnimVectorType.FLOAT1);
		}
		if (emitter.Latitude && typeof emitter.Latitude !== "number") {
			stream.keyword("KP2L");
			stream.animVector(emitter.Latitude, AnimVectorType.FLOAT1);
		}
		if (emitter.EmissionRate && typeof emitter.EmissionRate !== "number") {
			stream.keyword("KP2E");
			stream.animVector(emitter.EmissionRate, AnimVectorType.FLOAT1);
		}
		if (emitter.Visibility && typeof emitter.Visibility !== "number") {
			stream.keyword("KP2V");
			stream.animVector(emitter.Visibility, AnimVectorType.FLOAT1);
		}
		if (emitter.Length && typeof emitter.Length !== "number") {
			stream.keyword("KP2N");
			stream.animVector(emitter.Length, AnimVectorType.FLOAT1);
		}
		if (emitter.Width && typeof emitter.Width !== "number") {
			stream.keyword("KP2W");
			stream.animVector(emitter.Width, AnimVectorType.FLOAT1);
		}
		if (emitter.Gravity && typeof emitter.Gravity !== "number") {
			stream.keyword("KP2G");
			stream.animVector(emitter.Gravity, AnimVectorType.FLOAT1);
		}
		if (emitter.Variation && typeof emitter.Variation !== "number") {
			stream.keyword("KP2R");
			stream.animVector(emitter.Variation, AnimVectorType.FLOAT1);
		}
	}
}
function byteLengthRibbonEmitter(emitter) {
	return 4 + byteLengthNode(emitter) + 4 + 4 + 4 + 12 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + (emitter.Visibility ? 4 + byteLengthAnimVector(emitter.Visibility, AnimVectorType.FLOAT1) : 0) + (typeof emitter.HeightAbove !== "number" ? 4 + byteLengthAnimVector(emitter.HeightAbove, AnimVectorType.FLOAT1) : 0) + (typeof emitter.HeightBelow !== "number" ? 4 + byteLengthAnimVector(emitter.HeightBelow, AnimVectorType.FLOAT1) : 0) + (typeof emitter.Alpha !== "number" ? 4 + byteLengthAnimVector(emitter.Alpha, AnimVectorType.FLOAT1) : 0) + (typeof emitter.TextureSlot !== "number" ? 4 + byteLengthAnimVector(emitter.TextureSlot, AnimVectorType.FLOAT1) : 0);
}
function byteLengthRibbonEmitters(model) {
	if (!model.RibbonEmitters.length) return 0;
	return 8 + sum(model.RibbonEmitters.map(byteLengthRibbonEmitter));
}
function generateRibbonEmitters(model, stream) {
	if (!model.RibbonEmitters.length) return;
	stream.keyword("RIBB");
	stream.int32(byteLengthRibbonEmitters(model) - 8);
	for (const emitter of model.RibbonEmitters) {
		stream.int32(byteLengthRibbonEmitter(emitter));
		generateNode(emitter, stream);
		stream.float32(typeof emitter.HeightAbove === "number" ? emitter.HeightAbove : 0);
		stream.float32(typeof emitter.HeightBelow === "number" ? emitter.HeightBelow : 0);
		stream.float32(typeof emitter.Alpha === "number" ? emitter.Alpha : 0);
		if (emitter.Color) stream.float32Array(emitter.Color);
		else {
			stream.float32(1);
			stream.float32(1);
			stream.float32(1);
		}
		stream.float32(emitter.LifeSpan);
		stream.int32(typeof emitter.TextureSlot === "number" ? emitter.TextureSlot : 0);
		stream.int32(emitter.EmissionRate);
		stream.int32(emitter.Rows);
		stream.int32(emitter.Columns);
		stream.int32(emitter.MaterialID);
		stream.float32(emitter.Gravity);
		if (emitter.Visibility) {
			stream.keyword("KRVS");
			stream.animVector(emitter.Visibility, AnimVectorType.FLOAT1);
		}
		if (typeof emitter.HeightAbove !== "number") {
			stream.keyword("KRHA");
			stream.animVector(emitter.HeightAbove, AnimVectorType.FLOAT1);
		}
		if (typeof emitter.HeightBelow !== "number") {
			stream.keyword("KRHB");
			stream.animVector(emitter.HeightBelow, AnimVectorType.FLOAT1);
		}
		if (typeof emitter.Alpha !== "number") {
			stream.keyword("KRAL");
			stream.animVector(emitter.Alpha, AnimVectorType.FLOAT1);
		}
		if (typeof emitter.TextureSlot !== "number") {
			stream.keyword("KRTX");
			stream.animVector(emitter.TextureSlot, AnimVectorType.INT1);
		}
	}
}
var MODEL_CAMERA_NAME_LENGTH = 80;
function byteLengthCamera(camera) {
	return 4 + MODEL_CAMERA_NAME_LENGTH + 12 + 4 + 4 + 4 + 12 + (camera.Translation ? 4 + byteLengthAnimVector(camera.Translation, AnimVectorType.FLOAT3) : 0) + (camera.TargetTranslation ? 4 + byteLengthAnimVector(camera.TargetTranslation, AnimVectorType.FLOAT3) : 0) + (camera.Rotation ? 4 + byteLengthAnimVector(camera.Rotation, AnimVectorType.FLOAT1) : 0);
}
function byteLengthCameras(model) {
	if (!model.Cameras.length) return 0;
	return 8 + sum(model.Cameras.map(byteLengthCamera));
}
function generateCameras(model, stream) {
	if (!model.Cameras.length) return;
	stream.keyword("CAMS");
	stream.int32(byteLengthCameras(model) - 8);
	for (const camera of model.Cameras) {
		stream.int32(byteLengthCamera(camera));
		stream.str(camera.Name, MODEL_CAMERA_NAME_LENGTH);
		stream.float32Array(camera.Position);
		stream.float32(camera.FieldOfView);
		stream.float32(camera.FarClip);
		stream.float32(camera.NearClip);
		stream.float32Array(camera.TargetPosition);
		if (camera.Translation) {
			stream.keyword("KCTR");
			stream.animVector(camera.Translation, AnimVectorType.FLOAT3);
		}
		if (camera.Rotation) {
			stream.keyword("KCRL");
			stream.animVector(camera.Rotation, AnimVectorType.FLOAT1);
		}
		if (camera.TargetTranslation) {
			stream.keyword("KTTR");
			stream.animVector(camera.TargetTranslation, AnimVectorType.FLOAT3);
		}
	}
}
function byteLengthEventObject(eventObject) {
	return byteLengthNode(eventObject) + 4 + 4 + 4 + 4 * eventObject.EventTrack.length;
}
function byteLengthEventObjects(model) {
	if (model.EventObjects.length === 0) return 0;
	return 8 + sum(model.EventObjects.map(byteLengthEventObject));
}
function generateEventObjects(model, stream) {
	if (model.EventObjects.length === 0) return;
	stream.keyword("EVTS");
	stream.int32(byteLengthEventObjects(model) - 8);
	for (const eventObject of model.EventObjects) {
		generateNode(eventObject, stream);
		stream.keyword("KEVT");
		stream.int32(eventObject.EventTrack.length);
		stream.int32(NONE);
		stream.uint32Array(eventObject.EventTrack);
	}
}
function byteLengthCollisionShape(collisionShape) {
	return byteLengthNode(collisionShape) + 4 + (collisionShape.Shape === CollisionShapeType.Box ? 6 : 3) * 4 + (collisionShape.Shape === CollisionShapeType.Sphere ? 4 : 0);
}
function byteLengthCollisionShapes(model) {
	if (model.CollisionShapes.length === 0) return 0;
	return 8 + sum(model.CollisionShapes.map(byteLengthCollisionShape));
}
function generateCollisionShapes(model, stream) {
	if (model.CollisionShapes.length === 0) return;
	stream.keyword("CLID");
	stream.int32(byteLengthCollisionShapes(model) - 8);
	for (const collisionShape of model.CollisionShapes) {
		generateNode(collisionShape, stream);
		stream.int32(collisionShape.Shape);
		stream.float32Array(collisionShape.Vertices);
		if (collisionShape.Shape === CollisionShapeType.Sphere) stream.float32(collisionShape.BoundsRadius);
	}
}
function byteLengthFaceFX(model) {
	if (model.Version < 900 || !model.FaceFX) return 0;
	return 8 + 340 * model.FaceFX.length;
}
function generateFaceFX(model, stream) {
	if (model.Version < 900 || !model.FaceFX) return;
	stream.keyword("FAFX");
	stream.int32(byteLengthFaceFX(model) - 8);
	for (const faceFx of model.FaceFX) {
		stream.str(faceFx.Name, 80);
		stream.str(faceFx.Path, 260);
	}
}
function byteLengthBindPoseObject(bindPose) {
	return 48 * bindPose.Matrices.length;
}
function byteLengthBindPoses(model) {
	if (model.Version < 900 || !model.BindPoses) return 0;
	return 12 + sum(model.BindPoses.map(byteLengthBindPoseObject));
}
function generateBindPoses(model, stream) {
	if (model.Version < 900 || !model.BindPoses?.length) return;
	stream.keyword("BPOS");
	stream.int32(byteLengthBindPoses(model) - 8);
	const totalCount = model.BindPoses.reduce((acc, bindPose) => {
		return acc + bindPose.Matrices.length;
	}, 0);
	stream.int32(totalCount);
	for (const bindPose of model.BindPoses) for (const matrix of bindPose.Matrices) stream.float32Array(matrix);
}
function byteLengthParticleEmitterPopcorn(emitter) {
	return 4 + byteLengthNode(emitter) + 4 + 4 + 4 + 12 + 4 + 4 + 260 + 260 + (emitter.Alpha && typeof emitter.Alpha !== "number" ? 4 + byteLengthAnimVector(emitter.Alpha, AnimVectorType.FLOAT1) : 0) + (emitter.Visibility && typeof emitter.Visibility !== "number" ? 4 + byteLengthAnimVector(emitter.Visibility, AnimVectorType.FLOAT1) : 0) + (emitter.EmissionRate && typeof emitter.EmissionRate !== "number" ? 4 + byteLengthAnimVector(emitter.EmissionRate, AnimVectorType.FLOAT1) : 0) + (emitter.Color && !(emitter.Color instanceof Float32Array) ? 4 + byteLengthAnimVector(emitter.Color, AnimVectorType.FLOAT3) : 0) + (emitter.LifeSpan && typeof emitter.LifeSpan !== "number" ? 4 + byteLengthAnimVector(emitter.LifeSpan, AnimVectorType.FLOAT1) : 0) + (emitter.Speed && typeof emitter.Speed !== "number" ? 4 + byteLengthAnimVector(emitter.Speed, AnimVectorType.FLOAT1) : 0);
}
function byteLengthParticleEmitterPopcorns(model) {
	if (model.Version < 900 || !model.ParticleEmitterPopcorns?.length) return 0;
	return 8 + sum(model.ParticleEmitterPopcorns.map(byteLengthParticleEmitterPopcorn));
}
function generateParticleEmitterPopcorns(model, stream) {
	if (model.Version < 900 || !model.ParticleEmitterPopcorns?.length) return;
	stream.keyword("CORN");
	stream.int32(byteLengthParticleEmitterPopcorns(model) - 8);
	for (const emitter of model.ParticleEmitterPopcorns) {
		stream.int32(byteLengthParticleEmitterPopcorn(emitter));
		generateNode(emitter, stream);
		stream.float32(typeof emitter.LifeSpan === "number" ? emitter.LifeSpan : 0);
		stream.float32(typeof emitter.EmissionRate === "number" ? emitter.EmissionRate : 1);
		stream.float32(typeof emitter.Speed === "number" ? emitter.Speed : 0);
		if (emitter.Color instanceof Float32Array) {
			stream.float32(emitter.Color[0]);
			stream.float32(emitter.Color[1]);
			stream.float32(emitter.Color[2]);
		} else {
			stream.float32(1);
			stream.float32(1);
			stream.float32(1);
		}
		stream.float32(typeof emitter.Alpha === "number" ? emitter.Alpha : 1);
		stream.int32(typeof emitter.ReplaceableId === "number" ? emitter.ReplaceableId : 0);
		stream.str(emitter.Path, 260);
		stream.str(emitter.AnimVisibilityGuide, 260);
		if (emitter.Alpha && typeof emitter.Alpha !== "number") {
			stream.keyword("KPPA");
			stream.animVector(emitter.Alpha, AnimVectorType.FLOAT1);
		}
		if (emitter.Color && !(emitter.Color instanceof Float32Array)) {
			stream.keyword("KPPC");
			stream.animVector(emitter.Color, AnimVectorType.FLOAT3);
		}
		if (emitter.EmissionRate && typeof emitter.EmissionRate !== "number") {
			stream.keyword("KPPE");
			stream.animVector(emitter.EmissionRate, AnimVectorType.FLOAT1);
		}
		if (emitter.LifeSpan && typeof emitter.LifeSpan !== "number") {
			stream.keyword("KPPL");
			stream.animVector(emitter.LifeSpan, AnimVectorType.FLOAT1);
		}
		if (emitter.Speed && typeof emitter.Speed !== "number") {
			stream.keyword("KPPS");
			stream.animVector(emitter.Speed, AnimVectorType.FLOAT1);
		}
		if (emitter.Visibility && typeof emitter.Visibility !== "number") {
			stream.keyword("KPPV");
			stream.animVector(emitter.Visibility, AnimVectorType.FLOAT1);
		}
	}
}
var byteLength = [
	byteLengthVersion,
	byteLengthModelInfo,
	byteLengthSequences,
	byteLengthGlobalSequences,
	byteLengthMaterials,
	byteLengthTextures,
	byteLengthTextureAnims,
	byteLengthGeosets,
	byteLengthGeosetAnims,
	byteLengthBones,
	byteLengthLights,
	byteLengthHelpers,
	byteLengthAttachments,
	byteLengthPivotPoints,
	byteLengthParticleEmitters,
	byteLengthParticleEmitters2,
	byteLengthParticleEmitterPopcorns,
	byteLengthRibbonEmitters,
	byteLengthCameras,
	byteLengthEventObjects,
	byteLengthCollisionShapes,
	byteLengthFaceFX,
	byteLengthBindPoses
];
var generators = [
	generateVersion,
	generateModelInfo,
	generateSequences,
	generateGlobalSequences,
	generateMaterials,
	generateTextures,
	generateTextureAnims,
	generateGeosets,
	generateGeosetAnims,
	generateBones,
	generateLights,
	generateHelpers,
	generateAttachments,
	generatePivotPoints,
	generateParticleEmitters,
	generateParticleEmitters2,
	generateParticleEmitterPopcorns,
	generateRibbonEmitters,
	generateCameras,
	generateEventObjects,
	generateCollisionShapes,
	generateFaceFX,
	generateBindPoses
];
function generate$1(model) {
	let totalLength = 4;
	for (const lenFunc of byteLength) totalLength += lenFunc(model);
	const res = new ArrayBuffer(totalLength);
	const stream = new Stream(res);
	stream.keyword("MDLX");
	for (const generator of generators) generator(model, stream);
	return res;
}
//#endregion
//#region blp/blpimage.ts
var blpimage_exports = /* @__PURE__ */ __exportAll({
	BLPContent: () => BLPContent,
	BLPType: () => BLPType
});
var BLPType = /* @__PURE__ */ function(BLPType) {
	BLPType[BLPType["BLP0"] = 0] = "BLP0";
	BLPType[BLPType["BLP1"] = 1] = "BLP1";
	BLPType[BLPType["BLP2"] = 2] = "BLP2";
	return BLPType;
}({});
var BLPContent = /* @__PURE__ */ function(BLPContent) {
	BLPContent[BLPContent["JPEG"] = 0] = "JPEG";
	BLPContent[BLPContent["Direct"] = 1] = "Direct";
	return BLPContent;
}({});
//#endregion
//#region third_party/decoder.js
var JpegImage = (function jpegImage() {
	"use strict";
	var dctZigZag = new Int32Array([
		0,
		1,
		8,
		16,
		9,
		2,
		3,
		10,
		17,
		24,
		32,
		25,
		18,
		11,
		4,
		5,
		12,
		19,
		26,
		33,
		40,
		48,
		41,
		34,
		27,
		20,
		13,
		6,
		7,
		14,
		21,
		28,
		35,
		42,
		49,
		56,
		57,
		50,
		43,
		36,
		29,
		22,
		15,
		23,
		30,
		37,
		44,
		51,
		58,
		59,
		52,
		45,
		38,
		31,
		39,
		46,
		53,
		60,
		61,
		54,
		47,
		55,
		62,
		63
	]);
	var dctCos1 = 4017;
	var dctSin1 = 799;
	var dctCos3 = 3406;
	var dctSin3 = 2276;
	var dctCos6 = 1567;
	var dctSin6 = 3784;
	var dctSqrt2 = 5793;
	var dctSqrt1d2 = 2896;
	function constructor() {}
	function buildHuffmanTable(codeLengths, values) {
		var k = 0, code = [], i, j, length = 16;
		while (length > 0 && !codeLengths[length - 1]) length--;
		code.push({
			children: [],
			index: 0
		});
		var p = code[0], q;
		for (i = 0; i < length; i++) {
			for (j = 0; j < codeLengths[i]; j++) {
				p = code.pop();
				p.children[p.index] = values[k];
				while (p.index > 0) p = code.pop();
				p.index++;
				code.push(p);
				while (code.length <= i) {
					code.push(q = {
						children: [],
						index: 0
					});
					p.children[p.index] = q.children;
					p = q;
				}
				k++;
			}
			if (i + 1 < length) {
				code.push(q = {
					children: [],
					index: 0
				});
				p.children[p.index] = q.children;
				p = q;
			}
		}
		return code[0].children;
	}
	function getBlockBufferOffset(component, row, col) {
		return 64 * ((component.blocksPerLine + 1) * row + col);
	}
	function decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive) {
		frame.precision;
		frame.samplesPerLine;
		frame.scanLines;
		var mcusPerLine = frame.mcusPerLine;
		var progressive = frame.progressive;
		frame.maxH;
		frame.maxV;
		var startOffset = offset, bitsData = 0, bitsCount = 0;
		function readBit() {
			if (bitsCount > 0) {
				bitsCount--;
				return bitsData >> bitsCount & 1;
			}
			bitsData = data[offset++];
			if (bitsData == 255) {
				var nextByte = data[offset++];
				if (nextByte) throw "unexpected marker: " + (bitsData << 8 | nextByte).toString(16);
			}
			bitsCount = 7;
			return bitsData >>> 7;
		}
		function decodeHuffman(tree) {
			var node = tree;
			var bit;
			while ((bit = readBit()) !== null) {
				node = node[bit];
				if (typeof node === "number") return node;
				if (typeof node !== "object") throw "invalid huffman sequence";
			}
			return null;
		}
		function receive(length) {
			var n = 0;
			while (length > 0) {
				var bit = readBit();
				if (bit === null) return;
				n = n << 1 | bit;
				length--;
			}
			return n;
		}
		function receiveAndExtend(length) {
			var n = receive(length);
			if (n >= 1 << length - 1) return n;
			return n + (-1 << length) + 1;
		}
		function decodeBaseline(component, offset) {
			var t = decodeHuffman(component.huffmanTableDC);
			var diff = t === 0 ? 0 : receiveAndExtend(t);
			component.blockData[offset] = component.pred += diff;
			var k = 1;
			while (k < 64) {
				var rs = decodeHuffman(component.huffmanTableAC);
				var s = rs & 15, r = rs >> 4;
				if (s === 0) {
					if (r < 15) break;
					k += 16;
					continue;
				}
				k += r;
				var z = dctZigZag[k];
				component.blockData[offset + z] = receiveAndExtend(s);
				k++;
			}
		}
		function decodeDCFirst(component, offset) {
			var t = decodeHuffman(component.huffmanTableDC);
			var diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
			component.blockData[offset] = component.pred += diff;
		}
		function decodeDCSuccessive(component, offset) {
			component.blockData[offset] |= readBit() << successive;
		}
		var eobrun = 0;
		function decodeACFirst(component, offset) {
			if (eobrun > 0) {
				eobrun--;
				return;
			}
			var k = spectralStart, e = spectralEnd;
			while (k <= e) {
				var rs = decodeHuffman(component.huffmanTableAC);
				var s = rs & 15, r = rs >> 4;
				if (s === 0) {
					if (r < 15) {
						eobrun = receive(r) + (1 << r) - 1;
						break;
					}
					k += 16;
					continue;
				}
				k += r;
				var z = dctZigZag[k];
				component.blockData[offset + z] = receiveAndExtend(s) * (1 << successive);
				k++;
			}
		}
		var successiveACState = 0, successiveACNextValue;
		function decodeACSuccessive(component, offset) {
			var k = spectralStart, e = spectralEnd, r = 0;
			while (k <= e) {
				var z = dctZigZag[k];
				switch (successiveACState) {
					case 0:
						var rs = decodeHuffman(component.huffmanTableAC);
						var s = rs & 15, r = rs >> 4;
						if (s === 0) if (r < 15) {
							eobrun = receive(r) + (1 << r);
							successiveACState = 4;
						} else {
							r = 16;
							successiveACState = 1;
						}
						else {
							if (s !== 1) throw "invalid ACn encoding";
							successiveACNextValue = receiveAndExtend(s);
							successiveACState = r ? 2 : 3;
						}
						continue;
					case 1:
					case 2:
						if (component.blockData[offset + z]) component.blockData[offset + z] += readBit() << successive;
						else {
							r--;
							if (r === 0) successiveACState = successiveACState == 2 ? 3 : 0;
						}
						break;
					case 3:
						if (component.blockData[offset + z]) component.blockData[offset + z] += readBit() << successive;
						else {
							component.blockData[offset + z] = successiveACNextValue << successive;
							successiveACState = 0;
						}
						break;
					case 4:
						if (component.blockData[offset + z]) component.blockData[offset + z] += readBit() << successive;
						break;
				}
				k++;
			}
			if (successiveACState === 4) {
				eobrun--;
				if (eobrun === 0) successiveACState = 0;
			}
		}
		function decodeMcu(component, decode, mcu, row, col) {
			var mcuRow = mcu / mcusPerLine | 0;
			var mcuCol = mcu % mcusPerLine;
			decode(component, getBlockBufferOffset(component, mcuRow * component.v + row, mcuCol * component.h + col));
		}
		function decodeBlock(component, decode, mcu) {
			decode(component, getBlockBufferOffset(component, mcu / component.blocksPerLine | 0, mcu % component.blocksPerLine));
		}
		var componentsLength = components.length;
		var component, i, j, k, n;
		var decodeFn;
		if (progressive) if (spectralStart === 0) decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
		else decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
		else decodeFn = decodeBaseline;
		var mcu = 0, marker;
		var mcuExpected;
		if (componentsLength == 1) mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
		else mcuExpected = mcusPerLine * frame.mcusPerColumn;
		if (!resetInterval) resetInterval = mcuExpected;
		var h, v;
		while (mcu < mcuExpected) {
			for (i = 0; i < componentsLength; i++) components[i].pred = 0;
			eobrun = 0;
			if (componentsLength == 1) {
				component = components[0];
				for (n = 0; n < resetInterval; n++) {
					decodeBlock(component, decodeFn, mcu);
					mcu++;
				}
			} else for (n = 0; n < resetInterval; n++) {
				for (i = 0; i < componentsLength; i++) {
					component = components[i];
					h = component.h;
					v = component.v;
					for (j = 0; j < v; j++) for (k = 0; k < h; k++) decodeMcu(component, decodeFn, mcu, j, k);
				}
				mcu++;
			}
			bitsCount = 0;
			marker = data[offset] << 8 | data[offset + 1];
			if (marker <= 65280) throw "marker was not found";
			if (marker >= 65488 && marker <= 65495) offset += 2;
			else break;
		}
		return offset - startOffset;
	}
	function quantizeAndInverse(component, blockBufferOffset, p) {
		var qt = component.quantizationTable;
		var v0, v1, v2, v3, v4, v5, v6, v7, t;
		var i;
		for (i = 0; i < 64; i++) p[i] = component.blockData[blockBufferOffset + i] * qt[i];
		for (i = 0; i < 8; ++i) {
			var row = 8 * i;
			if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 && p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 && p[7 + row] == 0) {
				t = dctSqrt2 * p[0 + row] + 512 >> 10;
				p[0 + row] = t;
				p[1 + row] = t;
				p[2 + row] = t;
				p[3 + row] = t;
				p[4 + row] = t;
				p[5 + row] = t;
				p[6 + row] = t;
				p[7 + row] = t;
				continue;
			}
			v0 = dctSqrt2 * p[0 + row] + 128 >> 8;
			v1 = dctSqrt2 * p[4 + row] + 128 >> 8;
			v2 = p[2 + row];
			v3 = p[6 + row];
			v4 = dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128 >> 8;
			v7 = dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128 >> 8;
			v5 = p[3 + row] << 4;
			v6 = p[5 + row] << 4;
			t = v0 - v1 + 1 >> 1;
			v0 = v0 + v1 + 1 >> 1;
			v1 = t;
			t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
			v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
			v3 = t;
			t = v4 - v6 + 1 >> 1;
			v4 = v4 + v6 + 1 >> 1;
			v6 = t;
			t = v7 + v5 + 1 >> 1;
			v5 = v7 - v5 + 1 >> 1;
			v7 = t;
			t = v0 - v3 + 1 >> 1;
			v0 = v0 + v3 + 1 >> 1;
			v3 = t;
			t = v1 - v2 + 1 >> 1;
			v1 = v1 + v2 + 1 >> 1;
			v2 = t;
			t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
			v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
			v7 = t;
			t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
			v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
			v6 = t;
			p[0 + row] = v0 + v7;
			p[7 + row] = v0 - v7;
			p[1 + row] = v1 + v6;
			p[6 + row] = v1 - v6;
			p[2 + row] = v2 + v5;
			p[5 + row] = v2 - v5;
			p[3 + row] = v3 + v4;
			p[4 + row] = v3 - v4;
		}
		for (i = 0; i < 8; ++i) {
			var col = i;
			if (p[8 + col] == 0 && p[16 + col] == 0 && p[24 + col] == 0 && p[32 + col] == 0 && p[40 + col] == 0 && p[48 + col] == 0 && p[56 + col] == 0) {
				t = dctSqrt2 * p[i + 0] + 8192 >> 14;
				p[0 + col] = t;
				p[8 + col] = t;
				p[16 + col] = t;
				p[24 + col] = t;
				p[32 + col] = t;
				p[40 + col] = t;
				p[48 + col] = t;
				p[56 + col] = t;
				continue;
			}
			v0 = dctSqrt2 * p[0 + col] + 2048 >> 12;
			v1 = dctSqrt2 * p[32 + col] + 2048 >> 12;
			v2 = p[16 + col];
			v3 = p[48 + col];
			v4 = dctSqrt1d2 * (p[8 + col] - p[56 + col]) + 2048 >> 12;
			v7 = dctSqrt1d2 * (p[8 + col] + p[56 + col]) + 2048 >> 12;
			v5 = p[24 + col];
			v6 = p[40 + col];
			t = v0 - v1 + 1 >> 1;
			v0 = v0 + v1 + 1 >> 1;
			v1 = t;
			t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
			v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
			v3 = t;
			t = v4 - v6 + 1 >> 1;
			v4 = v4 + v6 + 1 >> 1;
			v6 = t;
			t = v7 + v5 + 1 >> 1;
			v5 = v7 - v5 + 1 >> 1;
			v7 = t;
			t = v0 - v3 + 1 >> 1;
			v0 = v0 + v3 + 1 >> 1;
			v3 = t;
			t = v1 - v2 + 1 >> 1;
			v1 = v1 + v2 + 1 >> 1;
			v2 = t;
			t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
			v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
			v7 = t;
			t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
			v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
			v6 = t;
			p[0 + col] = v0 + v7;
			p[56 + col] = v0 - v7;
			p[8 + col] = v1 + v6;
			p[48 + col] = v1 - v6;
			p[16 + col] = v2 + v5;
			p[40 + col] = v2 - v5;
			p[24 + col] = v3 + v4;
			p[32 + col] = v3 - v4;
		}
		for (i = 0; i < 64; ++i) {
			var index = blockBufferOffset + i;
			var q = p[i];
			q = q <= -2056 ? 0 : q >= 2024 ? 255 : q + 2056 >> 4;
			component.blockData[index] = q;
		}
	}
	function buildComponentData(frame, component) {
		var blocksPerLine = component.blocksPerLine;
		var blocksPerColumn = component.blocksPerColumn;
		blocksPerLine << 3;
		var computationBuffer = new Int32Array(64);
		for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) quantizeAndInverse(component, getBlockBufferOffset(component, blockRow, blockCol), computationBuffer);
		return component.blockData;
	}
	function clampToUint8(a) {
		return a <= 0 ? 0 : a >= 255 ? 255 : a | 0;
	}
	constructor.prototype = {
		load: function load(path) {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", path, true);
			xhr.responseType = "arraybuffer";
			xhr.onload = (function() {
				var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
				this.parse(data);
				if (this.onload) this.onload();
			}).bind(this);
			xhr.send(null);
		},
		loadFromBuffer: function loadFromBuffer(arrayBuffer) {
			this.parse(arrayBuffer);
			if (this.onload) this.onload();
		},
		parse: function parse(data) {
			function readUint16() {
				var value = data[offset] << 8 | data[offset + 1];
				offset += 2;
				return value;
			}
			function readDataBlock() {
				var length = readUint16();
				var array = data.subarray(offset, offset + length - 2);
				offset += array.length;
				return array;
			}
			function prepareComponents(frame) {
				var mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / frame.maxH);
				var mcusPerColumn = Math.ceil(frame.scanLines / 8 / frame.maxV);
				for (var i = 0; i < frame.components.length; i++) {
					component = frame.components[i];
					var blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / frame.maxH);
					var blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / frame.maxV);
					var blocksPerLineForMcu = mcusPerLine * component.h;
					var blocksBufferSize = 64 * (mcusPerColumn * component.v) * (blocksPerLineForMcu + 1);
					component.blockData = new Int16Array(blocksBufferSize);
					component.blocksPerLine = blocksPerLine;
					component.blocksPerColumn = blocksPerColumn;
				}
				frame.mcusPerLine = mcusPerLine;
				frame.mcusPerColumn = mcusPerColumn;
			}
			var offset = 0;
			data.length;
			var jfif = null;
			var adobe = null;
			var frame, resetInterval;
			var quantizationTables = [];
			var huffmanTablesAC = [], huffmanTablesDC = [];
			var fileMarker = readUint16();
			if (fileMarker != 65496) throw "SOI not found";
			fileMarker = readUint16();
			while (fileMarker != 65497) {
				var i, j, l;
				switch (fileMarker) {
					case 65504:
					case 65505:
					case 65506:
					case 65507:
					case 65508:
					case 65509:
					case 65510:
					case 65511:
					case 65512:
					case 65513:
					case 65514:
					case 65515:
					case 65516:
					case 65517:
					case 65518:
					case 65519:
					case 65534:
						var appData = readDataBlock();
						if (fileMarker === 65504) {
							if (appData[0] === 74 && appData[1] === 70 && appData[2] === 73 && appData[3] === 70 && appData[4] === 0) jfif = {
								version: {
									major: appData[5],
									minor: appData[6]
								},
								densityUnits: appData[7],
								xDensity: appData[8] << 8 | appData[9],
								yDensity: appData[10] << 8 | appData[11],
								thumbWidth: appData[12],
								thumbHeight: appData[13],
								thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
							};
						}
						if (fileMarker === 65518) {
							if (appData[0] === 65 && appData[1] === 100 && appData[2] === 111 && appData[3] === 98 && appData[4] === 101 && appData[5] === 0) adobe = {
								version: appData[6],
								flags0: appData[7] << 8 | appData[8],
								flags1: appData[9] << 8 | appData[10],
								transformCode: appData[11]
							};
						}
						break;
					case 65499:
						var quantizationTablesEnd = readUint16() + offset - 2;
						while (offset < quantizationTablesEnd) {
							var quantizationTableSpec = data[offset++];
							var tableData = new Int32Array(64);
							if (quantizationTableSpec >> 4 === 0) for (j = 0; j < 64; j++) {
								var z = dctZigZag[j];
								tableData[z] = data[offset++];
							}
							else if (quantizationTableSpec >> 4 === 1) for (j = 0; j < 64; j++) {
								var z = dctZigZag[j];
								tableData[z] = readUint16();
							}
							else throw "DQT: invalid table spec";
							quantizationTables[quantizationTableSpec & 15] = tableData;
						}
						break;
					case 65472:
					case 65473:
					case 65474:
						if (frame) throw "Only single frame JPEGs supported";
						readUint16();
						frame = {};
						frame.extended = fileMarker === 65473;
						frame.progressive = fileMarker === 65474;
						frame.precision = data[offset++];
						frame.scanLines = readUint16();
						frame.samplesPerLine = readUint16();
						frame.components = [];
						frame.componentIds = {};
						var componentsCount = data[offset++], componentId;
						var maxH = 0, maxV = 0;
						for (i = 0; i < componentsCount; i++) {
							componentId = data[offset];
							var h = data[offset + 1] >> 4;
							var v = data[offset + 1] & 15;
							if (maxH < h) maxH = h;
							if (maxV < v) maxV = v;
							var qId = data[offset + 2];
							var l = frame.components.push({
								h,
								v,
								quantizationTable: quantizationTables[qId]
							});
							frame.componentIds[componentId] = l - 1;
							offset += 3;
						}
						frame.maxH = maxH;
						frame.maxV = maxV;
						prepareComponents(frame);
						break;
					case 65476:
						var huffmanLength = readUint16();
						for (i = 2; i < huffmanLength;) {
							var huffmanTableSpec = data[offset++];
							var codeLengths = new Uint8Array(16);
							var codeLengthSum = 0;
							for (j = 0; j < 16; j++, offset++) codeLengthSum += codeLengths[j] = data[offset];
							var huffmanValues = new Uint8Array(codeLengthSum);
							for (j = 0; j < codeLengthSum; j++, offset++) huffmanValues[j] = data[offset];
							i += 17 + codeLengthSum;
							(huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
						}
						break;
					case 65501:
						readUint16();
						resetInterval = readUint16();
						break;
					case 65498:
						readUint16();
						var selectorsCount = data[offset++];
						var components = [], component;
						for (i = 0; i < selectorsCount; i++) {
							var componentIndex = frame.componentIds[data[offset++]];
							component = frame.components[componentIndex];
							var tableSpec = data[offset++];
							component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
							component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
							components.push(component);
						}
						var spectralStart = data[offset++];
						var spectralEnd = data[offset++];
						var successiveApproximation = data[offset++];
						var processed = decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15);
						offset += processed;
						break;
					default:
						if (data[offset - 3] == 255 && data[offset - 2] >= 192 && data[offset - 2] <= 254) {
							offset -= 3;
							break;
						}
						throw "unknown JPEG marker " + fileMarker.toString(16);
				}
				fileMarker = readUint16();
			}
			this.width = frame.samplesPerLine;
			this.height = frame.scanLines;
			this.jfif = jfif;
			this.adobe = adobe;
			this.components = [];
			for (var i = 0; i < frame.components.length; i++) {
				var component = frame.components[i];
				this.components.push({
					output: buildComponentData(frame, component),
					scaleX: component.h / frame.maxH,
					scaleY: component.v / frame.maxV,
					blocksPerLine: component.blocksPerLine,
					blocksPerColumn: component.blocksPerColumn
				});
			}
		},
		getData: function getData(imageData, width, height) {
			var scaleX = this.width / width, scaleY = this.height / height;
			var component, componentScaleX, componentScaleY;
			var x, y, i;
			var offset = 0;
			var numComponents = this.components.length;
			width * height * numComponents;
			var data = imageData.data;
			var lineData = new Uint8Array((this.components[0].blocksPerLine << 3) * this.components[0].blocksPerColumn * 8);
			for (i = 0; i < numComponents; i++) {
				component = this.components[i < 3 ? 2 - i : i];
				var blocksPerLine = component.blocksPerLine;
				var blocksPerColumn = component.blocksPerColumn;
				var samplesPerLine = blocksPerLine << 3, j, k;
				var lineOffset = 0;
				for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
					var scanLine = blockRow << 3;
					for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) {
						var bufferOffset = getBlockBufferOffset(component, blockRow, blockCol);
						var offset = 0, sample = blockCol << 3;
						for (j = 0; j < 8; j++) {
							var lineOffset = (scanLine + j) * samplesPerLine;
							for (k = 0; k < 8; k++) lineData[lineOffset + sample + k] = component.output[bufferOffset + offset++];
						}
					}
				}
				componentScaleX = component.scaleX * scaleX;
				componentScaleY = component.scaleY * scaleY;
				offset = i;
				var cx, cy;
				var index;
				for (y = 0; y < height; y++) for (x = 0; x < width; x++) {
					cy = 0 | y * componentScaleY;
					cx = 0 | x * componentScaleX;
					index = cy * samplesPerLine + cx;
					data[offset] = lineData[index];
					offset += numComponents;
				}
			}
			return data;
		},
		copyToImageData: function copyToImageData(imageData) {
			var width = imageData.width, height = imageData.height;
			var imageDataBytes = width * height * 4;
			var imageDataArray = imageData.data;
			var data = this.getData(width, height);
			var i = 0, j = 0, k0, k1;
			var Y, K, C, M, R, G, B;
			switch (this.components.length) {
				case 1:
					while (j < imageDataBytes) {
						Y = data[i++];
						imageDataArray[j++] = Y;
						imageDataArray[j++] = Y;
						imageDataArray[j++] = Y;
						imageDataArray[j++] = 255;
					}
					break;
				case 3:
					while (j < imageDataBytes) {
						R = data[i++];
						G = data[i++];
						B = data[i++];
						imageDataArray[j++] = R;
						imageDataArray[j++] = G;
						imageDataArray[j++] = B;
						imageDataArray[j++] = 255;
					}
					break;
				case 4:
					while (j < imageDataBytes) {
						C = data[i++];
						M = data[i++];
						Y = data[i++];
						K = data[i++];
						k0 = 255 - K;
						k1 = k0 / 255;
						R = clampToUint8(k0 - C * k1);
						G = clampToUint8(k0 - M * k1);
						B = clampToUint8(k0 - Y * k1);
						imageDataArray[j++] = R;
						imageDataArray[j++] = G;
						imageDataArray[j++] = B;
						imageDataArray[j++] = 255;
					}
					break;
				default: throw "Unsupported color mode";
			}
		}
	};
	return constructor;
})();
function decode$1(data) {
	const jpegImage = new JpegImage();
	jpegImage.loadFromBuffer(data);
	var imageData;
	if (typeof ImageData !== "undefined") imageData = new ImageData(jpegImage.width, jpegImage.height);
	else imageData = {
		width: jpegImage.width,
		height: jpegImage.height,
		data: new Uint8ClampedArray(jpegImage.width * jpegImage.height * 4)
	};
	jpegImage.getData(imageData, jpegImage.width, jpegImage.height);
	return imageData;
}
//#endregion
//#region blp/decode.ts
function keyword(view, offset) {
	return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}
function uint32(view, offset) {
	return view.getUint32(offset * 4, true);
}
function bitVal(data, bitCount, index) {
	const byte = data[Math.floor(index * bitCount / 8)], valsPerByte = 8 / bitCount;
	return byte >> valsPerByte - index % valsPerByte - 1 & (1 << bitCount) - 1;
}
function createImageData(width, height) {
	if (typeof ImageData !== "undefined") return new ImageData(width, height);
	else return {
		width,
		height,
		data: new Uint8ClampedArray(width * height * 4),
		colorSpace: "srgb"
	};
}
function decode(arrayBuffer) {
	const view = new DataView(arrayBuffer);
	const image = {
		type: BLPType.BLP1,
		width: 0,
		height: 0,
		content: BLPContent.JPEG,
		alphaBits: 0,
		mipmaps: [],
		data: arrayBuffer
	};
	const type = keyword(view, 0);
	if (type === "BLP0" || type === "BLP2") throw new Error("BLP0/BLP2 not supported");
	if (type !== "BLP1") throw new Error("Not a blp image");
	image.content = uint32(view, 1);
	if (image.content !== BLPContent.JPEG && image.content !== BLPContent.Direct) throw new Error("Unknown BLP content");
	image.alphaBits = uint32(view, 2);
	image.width = uint32(view, 3);
	image.height = uint32(view, 4);
	for (let i = 0; i < 16; ++i) {
		const mipmap = {
			offset: uint32(view, 7 + i),
			size: uint32(view, 23 + i)
		};
		if (mipmap.size > 0) image.mipmaps.push(mipmap);
		else break;
	}
	return image;
}
function getImageData(blp, mipmapLevel) {
	const view = new DataView(blp.data), uint8Data = new Uint8Array(blp.data), mipmap = blp.mipmaps[mipmapLevel];
	if (blp.content === BLPContent.JPEG) {
		const headerSize = uint32(view, 39), data = new Uint8Array(headerSize + mipmap.size);
		data.set(uint8Data.subarray(160, 160 + headerSize));
		data.set(uint8Data.subarray(mipmap.offset, mipmap.offset + mipmap.size), headerSize);
		return decode$1(data);
	} else {
		const palette = new Uint8Array(blp.data, 156, 256 * 4), width = blp.width / (1 << mipmapLevel), height = blp.height / (1 << mipmapLevel), size = width * height, alphaData = new Uint8Array(blp.data, mipmap.offset + size, Math.ceil(size * blp.alphaBits / 8)), imageData = createImageData(width, height), valPerAlphaBit = 255 / ((1 << blp.alphaBits) - 1);
		for (let i = 0; i < size; ++i) {
			const paletteIndex = view.getUint8(mipmap.offset + i) * 4;
			imageData.data[i * 4] = palette[paletteIndex + 2];
			imageData.data[i * 4 + 1] = palette[paletteIndex + 1];
			imageData.data[i * 4 + 2] = palette[paletteIndex];
			if (blp.alphaBits > 0) imageData.data[i * 4 + 3] = bitVal(alphaData, blp.alphaBits, i) * valPerAlphaBit;
			else imageData.data[i * 4 + 3] = 255;
		}
		return imageData;
	}
}
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
Math.PI / 180;
if (!Math.hypot) Math.hypot = function() {
	var y = 0, i = arguments.length;
	while (i--) y += arguments[i] * arguments[i];
	return Math.sqrt(y);
};
//#endregion
//#region ../mdx1800-light/node_modules/gl-matrix/esm/mat3.js
/**
* 3x3 Matrix
* @module mat3
*/
/**
* Creates a new identity mat3
*
* @returns {mat3} a new 3x3 matrix
*/
function create$4() {
	var out = new ARRAY_TYPE(9);
	if (ARRAY_TYPE != Float32Array) {
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		out[5] = 0;
		out[6] = 0;
		out[7] = 0;
	}
	out[0] = 1;
	out[4] = 1;
	out[8] = 1;
	return out;
}
/**
* Set the components of a mat3 to the given values
*
* @param {mat3} out the receiving matrix
* @param {Number} m00 Component in column 0, row 0 position (index 0)
* @param {Number} m01 Component in column 0, row 1 position (index 1)
* @param {Number} m02 Component in column 0, row 2 position (index 2)
* @param {Number} m10 Component in column 1, row 0 position (index 3)
* @param {Number} m11 Component in column 1, row 1 position (index 4)
* @param {Number} m12 Component in column 1, row 2 position (index 5)
* @param {Number} m20 Component in column 2, row 0 position (index 6)
* @param {Number} m21 Component in column 2, row 1 position (index 7)
* @param {Number} m22 Component in column 2, row 2 position (index 8)
* @returns {mat3} out
*/
function set$3(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
	out[0] = m00;
	out[1] = m01;
	out[2] = m02;
	out[3] = m10;
	out[4] = m11;
	out[5] = m12;
	out[6] = m20;
	out[7] = m21;
	out[8] = m22;
	return out;
}
//#endregion
//#region ../mdx1800-light/node_modules/gl-matrix/esm/mat4.js
/**
* 4x4 Matrix<br>Format: column-major, when typed out it looks like row-major<br>The matrices are being post multiplied.
* @module mat4
*/
/**
* Creates a new identity mat4
*
* @returns {mat4} a new 4x4 matrix
*/
function create$3() {
	var out = new ARRAY_TYPE(16);
	if (ARRAY_TYPE != Float32Array) {
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		out[4] = 0;
		out[6] = 0;
		out[7] = 0;
		out[8] = 0;
		out[9] = 0;
		out[11] = 0;
		out[12] = 0;
		out[13] = 0;
		out[14] = 0;
	}
	out[0] = 1;
	out[5] = 1;
	out[10] = 1;
	out[15] = 1;
	return out;
}
/**
* Set a mat4 to the identity matrix
*
* @param {mat4} out the receiving matrix
* @returns {mat4} out
*/
function identity(out) {
	out[0] = 1;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = 1;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[10] = 1;
	out[11] = 0;
	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
	return out;
}
/**
* Multiplies two mat4s
*
* @param {mat4} out the receiving matrix
* @param {ReadonlyMat4} a the first operand
* @param {ReadonlyMat4} b the second operand
* @returns {mat4} out
*/
function multiply(out, a, b) {
	var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
	var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	b0 = b[4];
	b1 = b[5];
	b2 = b[6];
	b3 = b[7];
	out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	b0 = b[8];
	b1 = b[9];
	b2 = b[10];
	b3 = b[11];
	out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	b0 = b[12];
	b1 = b[13];
	b2 = b[14];
	b3 = b[15];
	out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	return out;
}
/**
* Creates a matrix from a vector translation
* This is equivalent to (but much faster than):
*
*     mat4.identity(dest);
*     mat4.translate(dest, dest, vec);
*
* @param {mat4} out mat4 receiving operation result
* @param {ReadonlyVec3} v Translation vector
* @returns {mat4} out
*/
function fromTranslation(out, v) {
	out[0] = 1;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = 1;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[10] = 1;
	out[11] = 0;
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	out[15] = 1;
	return out;
}
/**
* Returns the scaling factor component of a transformation
*  matrix. If a matrix is built with fromRotationTranslationScale
*  with a normalized Quaternion paramter, the returned vector will be
*  the same as the scaling vector
*  originally supplied.
* @param  {vec3} out Vector to receive scaling factor component
* @param  {ReadonlyMat4} mat Matrix to be decomposed (input)
* @return {vec3} out
*/
function getScaling(out, mat) {
	var m11 = mat[0];
	var m12 = mat[1];
	var m13 = mat[2];
	var m21 = mat[4];
	var m22 = mat[5];
	var m23 = mat[6];
	var m31 = mat[8];
	var m32 = mat[9];
	var m33 = mat[10];
	out[0] = Math.hypot(m11, m12, m13);
	out[1] = Math.hypot(m21, m22, m23);
	out[2] = Math.hypot(m31, m32, m33);
	return out;
}
/**
* Returns a quaternion representing the rotational component
*  of a transformation matrix. If a matrix is built with
*  fromRotationTranslation, the returned quaternion will be the
*  same as the quaternion originally supplied.
* @param {quat} out Quaternion to receive the rotation component
* @param {ReadonlyMat4} mat Matrix to be decomposed (input)
* @return {quat} out
*/
function getRotation(out, mat) {
	var scaling = new ARRAY_TYPE(3);
	getScaling(scaling, mat);
	var is1 = 1 / scaling[0];
	var is2 = 1 / scaling[1];
	var is3 = 1 / scaling[2];
	var sm11 = mat[0] * is1;
	var sm12 = mat[1] * is2;
	var sm13 = mat[2] * is3;
	var sm21 = mat[4] * is1;
	var sm22 = mat[5] * is2;
	var sm23 = mat[6] * is3;
	var sm31 = mat[8] * is1;
	var sm32 = mat[9] * is2;
	var sm33 = mat[10] * is3;
	var trace = sm11 + sm22 + sm33;
	var S = 0;
	if (trace > 0) {
		S = Math.sqrt(trace + 1) * 2;
		out[3] = .25 * S;
		out[0] = (sm23 - sm32) / S;
		out[1] = (sm31 - sm13) / S;
		out[2] = (sm12 - sm21) / S;
	} else if (sm11 > sm22 && sm11 > sm33) {
		S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
		out[3] = (sm23 - sm32) / S;
		out[0] = .25 * S;
		out[1] = (sm12 + sm21) / S;
		out[2] = (sm31 + sm13) / S;
	} else if (sm22 > sm33) {
		S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
		out[3] = (sm31 - sm13) / S;
		out[0] = (sm12 + sm21) / S;
		out[1] = .25 * S;
		out[2] = (sm23 + sm32) / S;
	} else {
		S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
		out[3] = (sm12 - sm21) / S;
		out[0] = (sm31 + sm13) / S;
		out[1] = (sm23 + sm32) / S;
		out[2] = .25 * S;
	}
	return out;
}
/**
* Creates a matrix from a quaternion rotation, vector translation and vector scale
* This is equivalent to (but much faster than):
*
*     mat4.identity(dest);
*     mat4.translate(dest, vec);
*     let quatMat = mat4.create();
*     quat4.toMat4(quat, quatMat);
*     mat4.multiply(dest, quatMat);
*     mat4.scale(dest, scale)
*
* @param {mat4} out mat4 receiving operation result
* @param {quat4} q Rotation quaternion
* @param {ReadonlyVec3} v Translation vector
* @param {ReadonlyVec3} s Scaling vector
* @returns {mat4} out
*/
function fromRotationTranslationScale(out, q, v, s) {
	var x = q[0], y = q[1], z = q[2], w = q[3];
	var x2 = x + x;
	var y2 = y + y;
	var z2 = z + z;
	var xx = x * x2;
	var xy = x * y2;
	var xz = x * z2;
	var yy = y * y2;
	var yz = y * z2;
	var zz = z * z2;
	var wx = w * x2;
	var wy = w * y2;
	var wz = w * z2;
	var sx = s[0];
	var sy = s[1];
	var sz = s[2];
	out[0] = (1 - (yy + zz)) * sx;
	out[1] = (xy + wz) * sx;
	out[2] = (xz - wy) * sx;
	out[3] = 0;
	out[4] = (xy - wz) * sy;
	out[5] = (1 - (xx + zz)) * sy;
	out[6] = (yz + wx) * sy;
	out[7] = 0;
	out[8] = (xz + wy) * sz;
	out[9] = (yz - wx) * sz;
	out[10] = (1 - (xx + yy)) * sz;
	out[11] = 0;
	out[12] = v[0];
	out[13] = v[1];
	out[14] = v[2];
	out[15] = 1;
	return out;
}
/**
* Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
* This is equivalent to (but much faster than):
*
*     mat4.identity(dest);
*     mat4.translate(dest, vec);
*     mat4.translate(dest, origin);
*     let quatMat = mat4.create();
*     quat4.toMat4(quat, quatMat);
*     mat4.multiply(dest, quatMat);
*     mat4.scale(dest, scale)
*     mat4.translate(dest, negativeOrigin);
*
* @param {mat4} out mat4 receiving operation result
* @param {quat4} q Rotation quaternion
* @param {ReadonlyVec3} v Translation vector
* @param {ReadonlyVec3} s Scaling vector
* @param {ReadonlyVec3} o The origin vector around which to scale and rotate
* @returns {mat4} out
*/
function fromRotationTranslationScaleOrigin(out, q, v, s, o) {
	var x = q[0], y = q[1], z = q[2], w = q[3];
	var x2 = x + x;
	var y2 = y + y;
	var z2 = z + z;
	var xx = x * x2;
	var xy = x * y2;
	var xz = x * z2;
	var yy = y * y2;
	var yz = y * z2;
	var zz = z * z2;
	var wx = w * x2;
	var wy = w * y2;
	var wz = w * z2;
	var sx = s[0];
	var sy = s[1];
	var sz = s[2];
	var ox = o[0];
	var oy = o[1];
	var oz = o[2];
	var out0 = (1 - (yy + zz)) * sx;
	var out1 = (xy + wz) * sx;
	var out2 = (xz - wy) * sx;
	var out4 = (xy - wz) * sy;
	var out5 = (1 - (xx + zz)) * sy;
	var out6 = (yz + wx) * sy;
	var out8 = (xz + wy) * sz;
	var out9 = (yz - wx) * sz;
	var out10 = (1 - (xx + yy)) * sz;
	out[0] = out0;
	out[1] = out1;
	out[2] = out2;
	out[3] = 0;
	out[4] = out4;
	out[5] = out5;
	out[6] = out6;
	out[7] = 0;
	out[8] = out8;
	out[9] = out9;
	out[10] = out10;
	out[11] = 0;
	out[12] = v[0] + ox - (out0 * ox + out4 * oy + out8 * oz);
	out[13] = v[1] + oy - (out1 * ox + out5 * oy + out9 * oz);
	out[14] = v[2] + oz - (out2 * ox + out6 * oy + out10 * oz);
	out[15] = 1;
	return out;
}
/**
* Generates a perspective projection matrix with the given bounds.
* Passing null/undefined/no value for far will generate infinite projection matrix.
*
* @param {mat4} out mat4 frustum matrix will be written into
* @param {number} fovy Vertical field of view in radians
* @param {number} aspect Aspect ratio. typically viewport width/height
* @param {number} near Near bound of the frustum
* @param {number} far Far bound of the frustum, can be null or Infinity
* @returns {mat4} out
*/
function perspective(out, fovy, aspect, near, far) {
	var f = 1 / Math.tan(fovy / 2), nf;
	out[0] = f / aspect;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = f;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[11] = -1;
	out[12] = 0;
	out[13] = 0;
	out[15] = 0;
	if (far != null && far !== Infinity) {
		nf = 1 / (near - far);
		out[10] = (far + near) * nf;
		out[14] = 2 * far * near * nf;
	} else {
		out[10] = -1;
		out[14] = -2 * near;
	}
	return out;
}
/**
* Generates a look-at matrix with the given eye position, focal point, and up axis.
* If you want a matrix that actually makes an object look at another object, you should use targetTo instead.
*
* @param {mat4} out mat4 frustum matrix will be written into
* @param {ReadonlyVec3} eye Position of the viewer
* @param {ReadonlyVec3} center Point the viewer is looking at
* @param {ReadonlyVec3} up vec3 pointing up
* @returns {mat4} out
*/
function lookAt(out, eye, center, up) {
	var x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
	var eyex = eye[0];
	var eyey = eye[1];
	var eyez = eye[2];
	var upx = up[0];
	var upy = up[1];
	var upz = up[2];
	var centerx = center[0];
	var centery = center[1];
	var centerz = center[2];
	if (Math.abs(eyex - centerx) < 1e-6 && Math.abs(eyey - centery) < 1e-6 && Math.abs(eyez - centerz) < 1e-6) return identity(out);
	z0 = eyex - centerx;
	z1 = eyey - centery;
	z2 = eyez - centerz;
	len = 1 / Math.hypot(z0, z1, z2);
	z0 *= len;
	z1 *= len;
	z2 *= len;
	x0 = upy * z2 - upz * z1;
	x1 = upz * z0 - upx * z2;
	x2 = upx * z1 - upy * z0;
	len = Math.hypot(x0, x1, x2);
	if (!len) {
		x0 = 0;
		x1 = 0;
		x2 = 0;
	} else {
		len = 1 / len;
		x0 *= len;
		x1 *= len;
		x2 *= len;
	}
	y0 = z1 * x2 - z2 * x1;
	y1 = z2 * x0 - z0 * x2;
	y2 = z0 * x1 - z1 * x0;
	len = Math.hypot(y0, y1, y2);
	if (!len) {
		y0 = 0;
		y1 = 0;
		y2 = 0;
	} else {
		len = 1 / len;
		y0 *= len;
		y1 *= len;
		y2 *= len;
	}
	out[0] = x0;
	out[1] = y0;
	out[2] = z0;
	out[3] = 0;
	out[4] = x1;
	out[5] = y1;
	out[6] = z1;
	out[7] = 0;
	out[8] = x2;
	out[9] = y2;
	out[10] = z2;
	out[11] = 0;
	out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
	out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
	out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
	out[15] = 1;
	return out;
}
/**
* Alias for {@link mat4.multiply}
* @function
*/
var mul = multiply;
//#endregion
//#region ../mdx1800-light/node_modules/gl-matrix/esm/vec3.js
/**
* 3 Dimensional Vector
* @module vec3
*/
/**
* Creates a new, empty vec3
*
* @returns {vec3} a new 3D vector
*/
function create$2() {
	var out = new ARRAY_TYPE(3);
	if (ARRAY_TYPE != Float32Array) {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	}
	return out;
}
/**
* Creates a new vec3 initialized with values from an existing vector
*
* @param {ReadonlyVec3} a vector to clone
* @returns {vec3} a new 3D vector
*/
function clone$2(a) {
	var out = new ARRAY_TYPE(3);
	out[0] = a[0];
	out[1] = a[1];
	out[2] = a[2];
	return out;
}
/**
* Calculates the length of a vec3
*
* @param {ReadonlyVec3} a vector to calculate length of
* @returns {Number} length of a
*/
function length$2(a) {
	var x = a[0];
	var y = a[1];
	var z = a[2];
	return Math.hypot(x, y, z);
}
/**
* Creates a new vec3 initialized with the given values
*
* @param {Number} x X component
* @param {Number} y Y component
* @param {Number} z Z component
* @returns {vec3} a new 3D vector
*/
function fromValues$2(x, y, z) {
	var out = new ARRAY_TYPE(3);
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}
/**
* Copy the values from one vec3 to another
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the source vector
* @returns {vec3} out
*/
function copy$2(out, a) {
	out[0] = a[0];
	out[1] = a[1];
	out[2] = a[2];
	return out;
}
/**
* Set the components of a vec3 to the given values
*
* @param {vec3} out the receiving vector
* @param {Number} x X component
* @param {Number} y Y component
* @param {Number} z Z component
* @returns {vec3} out
*/
function set$2(out, x, y, z) {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}
/**
* Adds two vec3's
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @returns {vec3} out
*/
function add$2(out, a, b) {
	out[0] = a[0] + b[0];
	out[1] = a[1] + b[1];
	out[2] = a[2] + b[2];
	return out;
}
/**
* Subtracts vector b from vector a
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @returns {vec3} out
*/
function subtract(out, a, b) {
	out[0] = a[0] - b[0];
	out[1] = a[1] - b[1];
	out[2] = a[2] - b[2];
	return out;
}
/**
* Scales a vec3 by a scalar number
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the vector to scale
* @param {Number} b amount to scale the vector by
* @returns {vec3} out
*/
function scale$2(out, a, b) {
	out[0] = a[0] * b;
	out[1] = a[1] * b;
	out[2] = a[2] * b;
	return out;
}
/**
* Adds two vec3's after scaling the second operand by a scalar value
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @param {Number} scale the amount to scale b by before adding
* @returns {vec3} out
*/
function scaleAndAdd(out, a, b, scale) {
	out[0] = a[0] + b[0] * scale;
	out[1] = a[1] + b[1] * scale;
	out[2] = a[2] + b[2] * scale;
	return out;
}
/**
* Normalize a vec3
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a vector to normalize
* @returns {vec3} out
*/
function normalize$2(out, a) {
	var x = a[0];
	var y = a[1];
	var z = a[2];
	var len = x * x + y * y + z * z;
	if (len > 0) len = 1 / Math.sqrt(len);
	out[0] = a[0] * len;
	out[1] = a[1] * len;
	out[2] = a[2] * len;
	return out;
}
/**
* Calculates the dot product of two vec3's
*
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @returns {Number} dot product of a and b
*/
function dot$2(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
/**
* Computes the cross product of two vec3's
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @returns {vec3} out
*/
function cross(out, a, b) {
	var ax = a[0], ay = a[1], az = a[2];
	var bx = b[0], by = b[1], bz = b[2];
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
	return out;
}
/**
* Performs a linear interpolation between two vec3's
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {vec3} out
*/
function lerp$3(out, a, b, t) {
	var ax = a[0];
	var ay = a[1];
	var az = a[2];
	out[0] = ax + t * (b[0] - ax);
	out[1] = ay + t * (b[1] - ay);
	out[2] = az + t * (b[2] - az);
	return out;
}
/**
* Performs a hermite interpolation with two control points
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @param {ReadonlyVec3} c the third operand
* @param {ReadonlyVec3} d the fourth operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {vec3} out
*/
function hermite$1(out, a, b, c, d, t) {
	var factorTimes2 = t * t;
	var factor1 = factorTimes2 * (2 * t - 3) + 1;
	var factor2 = factorTimes2 * (t - 2) + t;
	var factor3 = factorTimes2 * (t - 1);
	var factor4 = factorTimes2 * (3 - 2 * t);
	out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
	out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
	out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
	return out;
}
/**
* Performs a bezier interpolation with two control points
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the first operand
* @param {ReadonlyVec3} b the second operand
* @param {ReadonlyVec3} c the third operand
* @param {ReadonlyVec3} d the fourth operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {vec3} out
*/
function bezier$1(out, a, b, c, d, t) {
	var inverseFactor = 1 - t;
	var inverseFactorTimesTwo = inverseFactor * inverseFactor;
	var factorTimes2 = t * t;
	var factor1 = inverseFactorTimesTwo * inverseFactor;
	var factor2 = 3 * t * inverseFactorTimesTwo;
	var factor3 = 3 * factorTimes2 * inverseFactor;
	var factor4 = factorTimes2 * t;
	out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
	out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
	out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
	return out;
}
/**
* Transforms the vec3 with a mat4.
* 4th vector component is implicitly '1'
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the vector to transform
* @param {ReadonlyMat4} m matrix to transform with
* @returns {vec3} out
*/
function transformMat4(out, a, m) {
	var x = a[0], y = a[1], z = a[2];
	var w = m[3] * x + m[7] * y + m[11] * z + m[15];
	w = w || 1;
	out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
	out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
	out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
	return out;
}
/**
* Transforms the vec3 with a quat
* Can also be used for dual quaternions. (Multiply it with the real part)
*
* @param {vec3} out the receiving vector
* @param {ReadonlyVec3} a the vector to transform
* @param {ReadonlyQuat} q quaternion to transform with
* @returns {vec3} out
*/
function transformQuat(out, a, q) {
	var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
	var x = a[0], y = a[1], z = a[2];
	var uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
	var uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
	var w2 = qw * 2;
	uvx *= w2;
	uvy *= w2;
	uvz *= w2;
	uuvx *= 2;
	uuvy *= 2;
	uuvz *= 2;
	out[0] = x + uvx + uuvx;
	out[1] = y + uvy + uuvy;
	out[2] = z + uvz + uuvz;
	return out;
}
/**
* Rotate a 3D vector around the y-axis
* @param {vec3} out The receiving vec3
* @param {ReadonlyVec3} a The vec3 point to rotate
* @param {ReadonlyVec3} b The origin of the rotation
* @param {Number} rad The angle of rotation in radians
* @returns {vec3} out
*/
function rotateY(out, a, b, rad) {
	var p = [], r = [];
	p[0] = a[0] - b[0];
	p[1] = a[1] - b[1];
	p[2] = a[2] - b[2];
	r[0] = p[2] * Math.sin(rad) + p[0] * Math.cos(rad);
	r[1] = p[1];
	r[2] = p[2] * Math.cos(rad) - p[0] * Math.sin(rad);
	out[0] = r[0] + b[0];
	out[1] = r[1] + b[1];
	out[2] = r[2] + b[2];
	return out;
}
/**
* Rotate a 3D vector around the z-axis
* @param {vec3} out The receiving vec3
* @param {ReadonlyVec3} a The vec3 point to rotate
* @param {ReadonlyVec3} b The origin of the rotation
* @param {Number} rad The angle of rotation in radians
* @returns {vec3} out
*/
function rotateZ(out, a, b, rad) {
	var p = [], r = [];
	p[0] = a[0] - b[0];
	p[1] = a[1] - b[1];
	p[2] = a[2] - b[2];
	r[0] = p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
	r[1] = p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
	r[2] = p[2];
	out[0] = r[0] + b[0];
	out[1] = r[1] + b[1];
	out[2] = r[2] + b[2];
	return out;
}
/**
* Alias for {@link vec3.subtract}
* @function
*/
var sub = subtract;
/**
* Alias for {@link vec3.length}
* @function
*/
var len = length$2;
(function() {
	var vec = create$2();
	return function(a, stride, offset, count, fn, arg) {
		var i, l;
		if (!stride) stride = 3;
		if (!offset) offset = 0;
		if (count) l = Math.min(count * stride + offset, a.length);
		else l = a.length;
		for (i = offset; i < l; i += stride) {
			vec[0] = a[i];
			vec[1] = a[i + 1];
			vec[2] = a[i + 2];
			fn(vec, vec, arg);
			a[i] = vec[0];
			a[i + 1] = vec[1];
			a[i + 2] = vec[2];
		}
		return a;
	};
})();
//#endregion
//#region ../mdx1800-light/node_modules/gl-matrix/esm/vec4.js
/**
* 4 Dimensional Vector
* @module vec4
*/
/**
* Creates a new, empty vec4
*
* @returns {vec4} a new 4D vector
*/
function create$1() {
	var out = new ARRAY_TYPE(4);
	if (ARRAY_TYPE != Float32Array) {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
	}
	return out;
}
/**
* Creates a new vec4 initialized with the given values
*
* @param {Number} x X component
* @param {Number} y Y component
* @param {Number} z Z component
* @param {Number} w W component
* @returns {vec4} a new 4D vector
*/
function fromValues$1(x, y, z, w) {
	var out = new ARRAY_TYPE(4);
	out[0] = x;
	out[1] = y;
	out[2] = z;
	out[3] = w;
	return out;
}
/**
* Copy the values from one vec4 to another
*
* @param {vec4} out the receiving vector
* @param {ReadonlyVec4} a the source vector
* @returns {vec4} out
*/
function copy$1(out, a) {
	out[0] = a[0];
	out[1] = a[1];
	out[2] = a[2];
	out[3] = a[3];
	return out;
}
/**
* Normalize a vec4
*
* @param {vec4} out the receiving vector
* @param {ReadonlyVec4} a vector to normalize
* @returns {vec4} out
*/
function normalize$1(out, a) {
	var x = a[0];
	var y = a[1];
	var z = a[2];
	var w = a[3];
	var len = x * x + y * y + z * z + w * w;
	if (len > 0) len = 1 / Math.sqrt(len);
	out[0] = x * len;
	out[1] = y * len;
	out[2] = z * len;
	out[3] = w * len;
	return out;
}
/**
* Performs a linear interpolation between two vec4's
*
* @param {vec4} out the receiving vector
* @param {ReadonlyVec4} a the first operand
* @param {ReadonlyVec4} b the second operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {vec4} out
*/
function lerp$2(out, a, b, t) {
	var ax = a[0];
	var ay = a[1];
	var az = a[2];
	var aw = a[3];
	out[0] = ax + t * (b[0] - ax);
	out[1] = ay + t * (b[1] - ay);
	out[2] = az + t * (b[2] - az);
	out[3] = aw + t * (b[3] - aw);
	return out;
}
(function() {
	var vec = create$1();
	return function(a, stride, offset, count, fn, arg) {
		var i, l;
		if (!stride) stride = 4;
		if (!offset) offset = 0;
		if (count) l = Math.min(count * stride + offset, a.length);
		else l = a.length;
		for (i = offset; i < l; i += stride) {
			vec[0] = a[i];
			vec[1] = a[i + 1];
			vec[2] = a[i + 2];
			vec[3] = a[i + 3];
			fn(vec, vec, arg);
			a[i] = vec[0];
			a[i + 1] = vec[1];
			a[i + 2] = vec[2];
			a[i + 3] = vec[3];
		}
		return a;
	};
})();
//#endregion
//#region ../mdx1800-light/node_modules/gl-matrix/esm/quat.js
/**
* Quaternion
* @module quat
*/
/**
* Creates a new identity quat
*
* @returns {quat} a new quaternion
*/
function create() {
	var out = new ARRAY_TYPE(4);
	if (ARRAY_TYPE != Float32Array) {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	}
	out[3] = 1;
	return out;
}
/**
* Sets a quat from the given angle and rotation axis,
* then returns it.
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyVec3} axis the axis around which to rotate
* @param {Number} rad the angle in radians
* @returns {quat} out
**/
function setAxisAngle(out, axis, rad) {
	rad = rad * .5;
	var s = Math.sin(rad);
	out[0] = s * axis[0];
	out[1] = s * axis[1];
	out[2] = s * axis[2];
	out[3] = Math.cos(rad);
	return out;
}
/**
* Performs a spherical linear interpolation between two quat
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyQuat} a the first operand
* @param {ReadonlyQuat} b the second operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {quat} out
*/
function slerp(out, a, b, t) {
	var ax = a[0], ay = a[1], az = a[2], aw = a[3];
	var bx = b[0], by = b[1], bz = b[2], bw = b[3];
	var omega, cosom = ax * bx + ay * by + az * bz + aw * bw, sinom, scale0, scale1;
	if (cosom < 0) {
		cosom = -cosom;
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
	}
	if (1 - cosom > 1e-6) {
		omega = Math.acos(cosom);
		sinom = Math.sin(omega);
		scale0 = Math.sin((1 - t) * omega) / sinom;
		scale1 = Math.sin(t * omega) / sinom;
	} else {
		scale0 = 1 - t;
		scale1 = t;
	}
	out[0] = scale0 * ax + scale1 * bx;
	out[1] = scale0 * ay + scale1 * by;
	out[2] = scale0 * az + scale1 * bz;
	out[3] = scale0 * aw + scale1 * bw;
	return out;
}
/**
* Calculates the inverse of a quat
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyQuat} a quat to calculate inverse of
* @returns {quat} out
*/
function invert(out, a) {
	var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
	var dot = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
	var invDot = dot ? 1 / dot : 0;
	out[0] = -a0 * invDot;
	out[1] = -a1 * invDot;
	out[2] = -a2 * invDot;
	out[3] = a3 * invDot;
	return out;
}
/**
* Creates a quaternion from the given 3x3 rotation matrix.
*
* NOTE: The resultant quaternion is not normalized, so you should be sure
* to renormalize the quaternion yourself where necessary.
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyMat3} m rotation matrix
* @returns {quat} out
* @function
*/
function fromMat3(out, m) {
	var fTrace = m[0] + m[4] + m[8];
	var fRoot;
	if (fTrace > 0) {
		fRoot = Math.sqrt(fTrace + 1);
		out[3] = .5 * fRoot;
		fRoot = .5 / fRoot;
		out[0] = (m[5] - m[7]) * fRoot;
		out[1] = (m[6] - m[2]) * fRoot;
		out[2] = (m[1] - m[3]) * fRoot;
	} else {
		var i = 0;
		if (m[4] > m[0]) i = 1;
		if (m[8] > m[i * 3 + i]) i = 2;
		var j = (i + 1) % 3;
		var k = (i + 2) % 3;
		fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1);
		out[i] = .5 * fRoot;
		fRoot = .5 / fRoot;
		out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
		out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
		out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
	}
	return out;
}
/**
* Creates a new quat initialized with the given values
*
* @param {Number} x X component
* @param {Number} y Y component
* @param {Number} z Z component
* @param {Number} w W component
* @returns {quat} a new quaternion
* @function
*/
var fromValues = fromValues$1;
/**
* Copy the values from one quat to another
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyQuat} a the source quaternion
* @returns {quat} out
* @function
*/
var copy = copy$1;
/**
* Normalize a quat
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyQuat} a quaternion to normalize
* @returns {quat} out
* @function
*/
var normalize = normalize$1;
/**
* Sets a quaternion to represent the shortest rotation from one
* vector to another.
*
* Both vectors are assumed to be unit length.
*
* @param {quat} out the receiving quaternion.
* @param {ReadonlyVec3} a the initial vector
* @param {ReadonlyVec3} b the destination vector
* @returns {quat} out
*/
var rotationTo = function() {
	var tmpvec3 = create$2();
	var xUnitVec3 = fromValues$2(1, 0, 0);
	var yUnitVec3 = fromValues$2(0, 1, 0);
	return function(out, a, b) {
		var dot = dot$2(a, b);
		if (dot < -.999999) {
			cross(tmpvec3, xUnitVec3, a);
			if (len(tmpvec3) < 1e-6) cross(tmpvec3, yUnitVec3, a);
			normalize$2(tmpvec3, tmpvec3);
			setAxisAngle(out, tmpvec3, Math.PI);
			return out;
		} else if (dot > .999999) {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			out[3] = 1;
			return out;
		} else {
			cross(tmpvec3, a, b);
			out[0] = tmpvec3[0];
			out[1] = tmpvec3[1];
			out[2] = tmpvec3[2];
			out[3] = 1 + dot;
			return normalize(out, out);
		}
	};
}();
/**
* Performs a spherical linear interpolation with two control points
*
* @param {quat} out the receiving quaternion
* @param {ReadonlyQuat} a the first operand
* @param {ReadonlyQuat} b the second operand
* @param {ReadonlyQuat} c the third operand
* @param {ReadonlyQuat} d the fourth operand
* @param {Number} t interpolation amount, in the range [0-1], between the two inputs
* @returns {quat} out
*/
var sqlerp = function() {
	var temp1 = create();
	var temp2 = create();
	return function(out, a, b, c, d, t) {
		slerp(temp1, a, d, t);
		slerp(temp2, b, c, t);
		slerp(out, temp1, temp2, 2 * t * (1 - t));
		return out;
	};
}();
(function() {
	var matr = create$4();
	return function(out, view, right, up) {
		matr[0] = right[0];
		matr[3] = right[1];
		matr[6] = right[2];
		matr[1] = up[0];
		matr[4] = up[1];
		matr[7] = up[2];
		matr[2] = -view[0];
		matr[5] = -view[1];
		matr[8] = -view[2];
		return normalize(out, fromMat3(out, matr));
	};
})();
//#endregion
//#region renderer/interp.ts
var findKeyframesRes = {
	frame: 0,
	left: null,
	right: null
};
function lerp(left, right, t) {
	return left * (1 - t) + right * t;
}
function bezier(left, outTan, inTan, right, t) {
	const inverseFactor = 1 - t, inverseFactorTimesTwo = inverseFactor * inverseFactor, factorTimes2 = t * t, factor1 = inverseFactorTimesTwo * inverseFactor, factor2 = 3 * t * inverseFactorTimesTwo, factor3 = 3 * factorTimes2 * inverseFactor, factor4 = factorTimes2 * t;
	return left * factor1 + outTan * factor2 + inTan * factor3 + right * factor4;
}
function hermite(left, outTan, inTan, right, t) {
	const factorTimes2 = t * t, factor1 = factorTimes2 * (2 * t - 3) + 1, factor2 = factorTimes2 * (t - 2) + t, factor3 = factorTimes2 * (t - 1), factor4 = factorTimes2 * (3 - 2 * t);
	return left * factor1 + outTan * factor2 + inTan * factor3 + right * factor4;
}
function findKeyframes(animVector, frame, from, to) {
	if (!animVector) return null;
	const array = animVector.Keys;
	let first = 0;
	let count = array.length;
	if (count === 0) return null;
	if (array[0].Frame > to) return null;
	else if (array[count - 1].Frame < from) return null;
	while (count > 0) {
		const step = count >> 1;
		if (array[first + step].Frame <= frame) {
			first = first + step + 1;
			count -= step + 1;
		} else count = step;
	}
	if (first === array.length || array[first].Frame > to) if (first > 0 && array[first - 1].Frame >= from) {
		findKeyframesRes.frame = frame;
		findKeyframesRes.left = array[first - 1];
		findKeyframesRes.right = array[first - 1];
		return findKeyframesRes;
	} else return null;
	if (first === 0 || array[first - 1].Frame < from) if (array[first].Frame <= to) {
		findKeyframesRes.frame = frame;
		findKeyframesRes.left = array[first];
		findKeyframesRes.right = array[first];
		return findKeyframesRes;
	} else return null;
	findKeyframesRes.frame = frame;
	findKeyframesRes.left = array[first - 1];
	findKeyframesRes.right = array[first];
	return findKeyframesRes;
}
function interpNum(frame, left, right, lineType) {
	if (left.Frame === right.Frame) return left.Vector[0];
	const t = (frame - left.Frame) / (right.Frame - left.Frame);
	if (lineType === LineType.DontInterp) return left.Vector[0];
	else if (lineType === LineType.Bezier) return bezier(left.Vector[0], left.OutTan[0], right.InTan[0], right.Vector[0], t);
	else if (lineType === LineType.Hermite) return hermite(left.Vector[0], left.OutTan[0], right.InTan[0], right.Vector[0], t);
	else return lerp(left.Vector[0], right.Vector[0], t);
}
function interpVec3(out, frame, left, right, lineType) {
	if (left.Frame === right.Frame) return left.Vector;
	const t = (frame - left.Frame) / (right.Frame - left.Frame);
	if (lineType === LineType.DontInterp) return left.Vector;
	else if (lineType === LineType.Bezier) return bezier$1(out, left.Vector, left.OutTan, right.InTan, right.Vector, t);
	else if (lineType === LineType.Hermite) return hermite$1(out, left.Vector, left.OutTan, right.InTan, right.Vector, t);
	else return lerp$3(out, left.Vector, right.Vector, t);
}
function interpQuat(out, frame, left, right, lineType) {
	if (left.Frame === right.Frame) return left.Vector;
	const t = (frame - left.Frame) / (right.Frame - left.Frame);
	if (lineType === LineType.DontInterp) return left.Vector;
	else if (lineType === LineType.Hermite || lineType === LineType.Bezier) return sqlerp(out, left.Vector, left.OutTan, right.InTan, right.Vector, t);
	else return slerp(out, left.Vector, right.Vector, t);
}
//#endregion
//#region renderer/modelInterp.ts
var findLocalFrameRes = {
	frame: 0,
	from: 0,
	to: 0
};
var ModelInterp = class {
	static maxAnimVectorVal(vector) {
		if (typeof vector === "number") return vector;
		let max = vector.Keys[0].Vector[0];
		for (let i = 1; i < vector.Keys.length; ++i) if (vector.Keys[i].Vector[0] > max) max = vector.Keys[i].Vector[0];
		return max;
	}
	constructor(rendererData) {
		this.rendererData = rendererData;
	}
	num(animVector) {
		const res = this.findKeyframes(animVector);
		if (!res) return null;
		return interpNum(res.frame, res.left, res.right, animVector.LineType);
	}
	vec3(out, animVector) {
		const res = this.findKeyframes(animVector);
		if (!res) return null;
		return interpVec3(out, res.frame, res.left, res.right, animVector.LineType);
	}
	quat(out, animVector) {
		const res = this.findKeyframes(animVector);
		if (!res) return null;
		return interpQuat(out, res.frame, res.left, res.right, animVector.LineType);
	}
	animVectorVal(vector, defaultVal) {
		let res;
		if (typeof vector === "number") res = vector;
		else {
			res = this.num(vector);
			if (res === null) res = defaultVal;
		}
		return res;
	}
	findKeyframes(animVector) {
		if (!animVector) return null;
		const { frame, from, to } = this.findLocalFrame(animVector);
		return findKeyframes(animVector, frame, from, to);
	}
	findLocalFrame(animVector) {
		if (typeof animVector.GlobalSeqId === "number") {
			findLocalFrameRes.frame = this.rendererData.globalSequencesFrames[animVector.GlobalSeqId];
			findLocalFrameRes.from = 0;
			findLocalFrameRes.to = this.rendererData.model.GlobalSequences[animVector.GlobalSeqId];
		} else {
			findLocalFrameRes.frame = this.rendererData.frame;
			findLocalFrameRes.from = this.rendererData.animationInfo.Interval[0];
			findLocalFrameRes.to = this.rendererData.animationInfo.Interval[1];
		}
		return findLocalFrameRes;
	}
};
//#endregion
//#region renderer/shaders/webgl/particles.vs.glsl?raw
var particles_vs_default = "attribute vec3 aVertexPosition;\nattribute vec2 aTextureCoord;\nattribute vec4 aColor;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec2 vTextureCoord;\nvarying vec4 vColor;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n    vColor = aColor;\n}\n";
//#endregion
//#region renderer/shaders/webgl/particles.fs.glsl?raw
var particles_fs_default = "precision mediump float;\n\nvarying vec2 vTextureCoord;\nvarying vec4 vColor;\n\nuniform sampler2D uSampler;\nuniform vec3 uReplaceableColor;\nuniform float uReplaceableType;\nuniform float uDiscardAlphaLevel;\n\nfloat hypot (vec2 z) {\n    float t;\n    float x = abs(z.x);\n    float y = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    return (z.x == 0.0 && z.y == 0.0) ? 0.0 : x * sqrt(1.0 + t * t);\n}\n\nvoid main(void) {\n    vec2 coords = vec2(vTextureCoord.s, vTextureCoord.t);\n    if (uReplaceableType == 0.) {\n        gl_FragColor = texture2D(uSampler, coords);\n    } else if (uReplaceableType == 1.) {\n        gl_FragColor = vec4(uReplaceableColor, 1.0);\n    } else if (uReplaceableType == 2.) {\n        float dist = hypot(coords - vec2(0.5, 0.5)) * 2.;\n        float truncateDist = clamp(1. - dist * 1.4, 0., 1.);\n        float alpha = sin(truncateDist);\n        gl_FragColor = vec4(uReplaceableColor * alpha, 1.0);\n    }\n    gl_FragColor *= vColor;\n\n    if (gl_FragColor[3] < uDiscardAlphaLevel) {\n        discard;\n    }\n}\n";
//#endregion
//#region renderer/shaders/webgpu/particles.wgsl?raw
var particles_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\nstruct FSUniforms {\n    replaceableColor: vec3f,\n    replaceableType: u32,\n    discardAlphaLevel: f32,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformSampler: sampler;\n@group(1) @binding(2) var fsUniformTexture: texture_2d<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) textureCoord: vec2f,\n    @location(2) color: vec4f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) textureCoord: vec2f,\n    @location(1) color: vec4f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.textureCoord = in.textureCoord;\n    out.color = in.color;\n    return out;\n}\n\nfn hypot(z: vec2f) -> f32 {\n    var t: f32 = 0;\n    var x: f32 = abs(z.x);\n    let y: f32 = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    if (z.x == 0.0 && z.y == 0.0) {\n        return 0.0;\n    }\n    return x * sqrt(1.0 + t * t);\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    let texCoord: vec2f = in.textureCoord;\n    var color: vec4f = vec4f(0.0);\n\n    if (fsUniforms.replaceableType == 0) {\n        color = textureSample(fsUniformTexture, fsUniformSampler, texCoord);\n    } else if (fsUniforms.replaceableType == 1) {\n        color = vec4f(fsUniforms.replaceableColor, 1.0);\n    } else if (fsUniforms.replaceableType == 2) {\n        let dist: f32 = hypot(texCoord - vec2(0.5, 0.5)) * 2.;\n        let truncateDist: f32 = clamp(1. - dist * 1.4, 0., 1.);\n        let alpha: f32 = sin(truncateDist);\n        color = vec4f(fsUniforms.replaceableColor * alpha, 1.0);\n    }\n\n    color *= in.color;\n\n    // hand-made alpha-test\n    if (color.a < fsUniforms.discardAlphaLevel) {\n        discard;\n    }\n\n    return color;\n}\n";
//#endregion
//#region renderer/particles.ts
var rotateCenter = fromValues$2(0, 0, 0);
var firstColor = create$1();
var secondColor = create$1();
var color = create$1();
var tailPos = create$2();
var tailCross = create$2();
var DISCARD_ALPHA_KEY_LEVEL = .83;
var DISCARD_MODULATE_LEVEL = .01;
var ParticlesController = class {
	constructor(interp, rendererData) {
		this.shaderProgramLocations = {
			vertexPositionAttribute: null,
			textureCoordAttribute: null,
			colorAttribute: null,
			pMatrixUniform: null,
			mvMatrixUniform: null,
			samplerUniform: null,
			replaceableColorUniform: null,
			replaceableTypeUniform: null,
			discardAlphaLevelUniform: null
		};
		this.particleStorage = [];
		this.interp = interp;
		this.rendererData = rendererData;
		this.emitters = [];
		if (rendererData.model.ParticleEmitters2.length) {
			this.particleBaseVectors = [
				create$2(),
				create$2(),
				create$2(),
				create$2()
			];
			for (let i = 0; i < rendererData.model.ParticleEmitters2.length; ++i) {
				const particleEmitter = rendererData.model.ParticleEmitters2[i];
				const emitter = {
					index: i,
					emission: 0,
					squirtFrame: 0,
					particles: [],
					props: particleEmitter,
					capacity: 0,
					baseCapacity: 0,
					type: particleEmitter.FrameFlags,
					tailVertices: null,
					tailVertexBuffer: null,
					tailVertexGPUBuffer: null,
					headVertices: null,
					headVertexBuffer: null,
					headVertexGPUBuffer: null,
					tailTexCoords: null,
					tailTexCoordBuffer: null,
					tailTexCoordGPUBuffer: null,
					headTexCoords: null,
					headTexCoordBuffer: null,
					headTexCoordGPUBuffer: null,
					colors: null,
					colorBuffer: null,
					colorGPUBuffer: null,
					indices: null,
					indexBuffer: null,
					indexGPUBuffer: null,
					fsUniformsBuffer: null
				};
				emitter.baseCapacity = Math.ceil(ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * emitter.props.LifeSpan);
				this.emitters.push(emitter);
			}
		}
	}
	destroy() {
		if (this.shaderProgram) {
			if (this.vertexShader) {
				this.gl.detachShader(this.shaderProgram, this.vertexShader);
				this.gl.deleteShader(this.vertexShader);
				this.vertexShader = null;
			}
			if (this.fragmentShader) {
				this.gl.detachShader(this.shaderProgram, this.fragmentShader);
				this.gl.deleteShader(this.fragmentShader);
				this.fragmentShader = null;
			}
			this.gl.deleteProgram(this.shaderProgram);
			this.shaderProgram = null;
		}
		this.particleStorage = [];
		if (this.gpuVSUniformsBuffer) {
			this.gpuVSUniformsBuffer.destroy();
			this.gpuVSUniformsBuffer = null;
		}
		for (const emitter of this.emitters) {
			if (emitter.colorGPUBuffer) emitter.colorGPUBuffer.destroy();
			if (emitter.indexGPUBuffer) emitter.indexGPUBuffer.destroy();
			if (emitter.headVertexGPUBuffer) emitter.headVertexGPUBuffer.destroy();
			if (emitter.tailVertexGPUBuffer) emitter.tailVertexGPUBuffer.destroy();
			if (emitter.headTexCoordGPUBuffer) emitter.headTexCoordGPUBuffer.destroy();
			if (emitter.tailTexCoordGPUBuffer) emitter.tailTexCoordGPUBuffer.destroy();
			if (emitter.fsUniformsBuffer) emitter.fsUniformsBuffer.destroy();
		}
		this.emitters = [];
	}
	initGL(glContext) {
		this.gl = glContext;
		this.initShaders();
	}
	initGPUDevice(device) {
		this.device = device;
		this.gpuShaderModule = device.createShaderModule({
			label: "particles shader module",
			code: particles_default
		});
		this.vsBindGroupLayout = this.device.createBindGroupLayout({
			label: "particles vs bind group layout",
			entries: [{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: {
					type: "uniform",
					hasDynamicOffset: false,
					minBindingSize: 128
				}
			}]
		});
		this.fsBindGroupLayout = this.device.createBindGroupLayout({
			label: "particles bind group layout2",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {
						type: "uniform",
						hasDynamicOffset: false,
						minBindingSize: 32
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				}
			]
		});
		this.gpuPipelineLayout = this.device.createPipelineLayout({
			label: "particles pipeline layout",
			bindGroupLayouts: [this.vsBindGroupLayout, this.fsBindGroupLayout]
		});
		const createPipeline = (name, blend, depth) => {
			return device.createRenderPipeline({
				label: `particles pipeline ${name}`,
				layout: this.gpuPipelineLayout,
				vertex: {
					module: this.gpuShaderModule,
					buffers: [
						{
							arrayStride: 12,
							attributes: [{
								shaderLocation: 0,
								offset: 0,
								format: "float32x3"
							}]
						},
						{
							arrayStride: 8,
							attributes: [{
								shaderLocation: 1,
								offset: 0,
								format: "float32x2"
							}]
						},
						{
							arrayStride: 16,
							attributes: [{
								shaderLocation: 2,
								offset: 0,
								format: "float32x4"
							}]
						}
					]
				},
				fragment: {
					module: this.gpuShaderModule,
					targets: [{
						format: navigator.gpu.getPreferredCanvasFormat(),
						blend
					}]
				},
				depthStencil: depth
			});
		};
		this.gpuPipelines = [
			createPipeline("blend", {
				color: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha"
				},
				alpha: {
					operation: "add",
					srcFactor: "one",
					dstFactor: "one-minus-src-alpha"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("additive", {
				color: {
					operation: "add",
					srcFactor: "src",
					dstFactor: "one"
				},
				alpha: {
					operation: "add",
					srcFactor: "src",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("modulate", {
				color: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "src"
				},
				alpha: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("modulate2x", {
				color: {
					operation: "add",
					srcFactor: "dst",
					dstFactor: "src"
				},
				alpha: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("alphaKey", {
				color: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one"
				},
				alpha: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			})
		];
		this.gpuVSUniformsBuffer = this.device.createBuffer({
			label: "particles vs uniforms",
			size: 128,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.gpuVSUniformsBindGroup = this.device.createBindGroup({
			layout: this.vsBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: this.gpuVSUniformsBuffer }
			}]
		});
	}
	initShaders() {
		const vertex = this.vertexShader = getShader(this.gl, particles_vs_default, this.gl.VERTEX_SHADER);
		const fragment = this.fragmentShader = getShader(this.gl, particles_fs_default, this.gl.FRAGMENT_SHADER);
		const shaderProgram = this.shaderProgram = this.gl.createProgram();
		this.gl.attachShader(shaderProgram, vertex);
		this.gl.attachShader(shaderProgram, fragment);
		this.gl.linkProgram(shaderProgram);
		if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) alert("Could not initialise shaders");
		this.gl.useProgram(shaderProgram);
		this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, "aVertexPosition");
		this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(shaderProgram, "aTextureCoord");
		this.shaderProgramLocations.colorAttribute = this.gl.getAttribLocation(shaderProgram, "aColor");
		this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uPMatrix");
		this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uMVMatrix");
		this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, "uSampler");
		this.shaderProgramLocations.replaceableColorUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableColor");
		this.shaderProgramLocations.replaceableTypeUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableType");
		this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(shaderProgram, "uDiscardAlphaLevel");
	}
	updateParticle(particle, delta) {
		delta /= 1e3;
		particle.lifeSpan -= delta;
		if (particle.lifeSpan <= 0) return;
		particle.speed[2] -= particle.gravity * delta;
		particle.pos[0] += particle.speed[0] * delta;
		particle.pos[1] += particle.speed[1] * delta;
		particle.pos[2] += particle.speed[2] * delta;
	}
	resizeEmitterBuffers(emitter, size) {
		if (size <= emitter.capacity) return;
		size = Math.max(size, emitter.baseCapacity);
		let tailVertices;
		let headVertices;
		let tailTexCoords;
		let headTexCoords;
		if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
			tailVertices = new Float32Array(size * 4 * 3);
			tailTexCoords = new Float32Array(size * 4 * 2);
		}
		if (emitter.type & ParticleEmitter2FramesFlags.Head) {
			headVertices = new Float32Array(size * 4 * 3);
			headTexCoords = new Float32Array(size * 4 * 2);
		}
		const colors = new Float32Array(size * 4 * 4);
		const indices = new Uint16Array(size * 6);
		if (emitter.capacity) indices.set(emitter.indices);
		for (let i = emitter.capacity; i < size; ++i) {
			indices[i * 6] = i * 4;
			indices[i * 6 + 1] = i * 4 + 1;
			indices[i * 6 + 2] = i * 4 + 2;
			indices[i * 6 + 3] = i * 4 + 2;
			indices[i * 6 + 4] = i * 4 + 1;
			indices[i * 6 + 5] = i * 4 + 3;
		}
		if (tailVertices) {
			emitter.tailVertices = tailVertices;
			emitter.tailTexCoords = tailTexCoords;
		}
		if (headVertices) {
			emitter.headVertices = headVertices;
			emitter.headTexCoords = headTexCoords;
		}
		emitter.colors = colors;
		emitter.indices = indices;
		emitter.capacity = size;
		if (!emitter.indexBuffer) {
			if (this.gl) {
				if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
					emitter.tailVertexBuffer = this.gl.createBuffer();
					emitter.tailTexCoordBuffer = this.gl.createBuffer();
				}
				if (emitter.type & ParticleEmitter2FramesFlags.Head) {
					emitter.headVertexBuffer = this.gl.createBuffer();
					emitter.headTexCoordBuffer = this.gl.createBuffer();
				}
				emitter.colorBuffer = this.gl.createBuffer();
				emitter.indexBuffer = this.gl.createBuffer();
			} else if (this.device) {
				if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
					emitter.tailVertexGPUBuffer?.destroy();
					emitter.tailVertexGPUBuffer = this.device.createBuffer({
						label: `particles tail vertex buffer ${emitter.index}`,
						size: tailVertices.byteLength,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
					});
					emitter.tailTexCoordGPUBuffer?.destroy();
					emitter.tailTexCoordGPUBuffer = this.device.createBuffer({
						label: `particles tail texCoords buffer ${emitter.index}`,
						size: tailTexCoords.byteLength,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
					});
				}
				if (emitter.type & ParticleEmitter2FramesFlags.Head) {
					emitter.headVertexGPUBuffer?.destroy();
					emitter.headVertexGPUBuffer = this.device.createBuffer({
						label: `particles head vertex buffer ${emitter.index}`,
						size: headVertices.byteLength,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
					});
					emitter.headTexCoordGPUBuffer?.destroy();
					emitter.headTexCoordGPUBuffer = this.device.createBuffer({
						label: `particles head texCoords buffer ${emitter.index}`,
						size: headTexCoords.byteLength,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
					});
				}
				emitter.colorGPUBuffer?.destroy();
				emitter.colorGPUBuffer = this.device.createBuffer({
					label: `particles color buffer ${emitter.index}`,
					size: colors.byteLength,
					usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
				});
				emitter.indexGPUBuffer?.destroy();
				emitter.indexGPUBuffer = this.device.createBuffer({
					label: `particles index buffer ${emitter.index}`,
					size: indices.byteLength,
					usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
				});
			}
		}
	}
	update(delta) {
		for (const emitter of this.emitters) this.updateEmitter(emitter, delta);
	}
	render(mvMatrix, pMatrix) {
		this.gl.enable(this.gl.CULL_FACE);
		this.gl.useProgram(this.shaderProgram);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.colorAttribute);
		for (const emitter of this.emitters) {
			if (!emitter.particles.length) continue;
			this.setLayerProps(emitter);
			this.setGeneralBuffers(emitter);
			if (emitter.type & ParticleEmitter2FramesFlags.Tail) this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Tail);
			if (emitter.type & ParticleEmitter2FramesFlags.Head) this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Head);
		}
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.colorAttribute);
	}
	renderGPUEmitterType(pass, emitter, type) {
		if (type === ParticleEmitter2FramesFlags.Tail) {
			this.device.queue.writeBuffer(emitter.tailTexCoordGPUBuffer, 0, emitter.tailTexCoords);
			pass.setVertexBuffer(1, emitter.tailTexCoordGPUBuffer);
		} else {
			this.device.queue.writeBuffer(emitter.headTexCoordGPUBuffer, 0, emitter.headTexCoords);
			pass.setVertexBuffer(1, emitter.headTexCoordGPUBuffer);
		}
		if (type === ParticleEmitter2FramesFlags.Tail) {
			this.device.queue.writeBuffer(emitter.tailVertexGPUBuffer, 0, emitter.tailVertices);
			pass.setVertexBuffer(0, emitter.tailVertexGPUBuffer);
		} else {
			this.device.queue.writeBuffer(emitter.headVertexGPUBuffer, 0, emitter.headVertices);
			pass.setVertexBuffer(0, emitter.headVertexGPUBuffer);
		}
		pass.drawIndexed(emitter.particles.length * 6);
	}
	renderGPU(pass, mvMatrix, pMatrix) {
		const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
		const VSUniformsViews = {
			mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
			pMatrix: new Float32Array(VSUniformsValues, 64, 16)
		};
		VSUniformsViews.mvMatrix.set(mvMatrix);
		VSUniformsViews.pMatrix.set(pMatrix);
		this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);
		pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
		for (const emitter of this.emitters) {
			if (!emitter.particles.length) continue;
			const pipeline = this.gpuPipelines[emitter.props.FilterMode] || this.gpuPipelines[0];
			pass.setPipeline(pipeline);
			const textureID = emitter.props.TextureID;
			const texture = this.rendererData.model.Textures[textureID];
			const fsUniformsValues = /* @__PURE__ */ new ArrayBuffer(32);
			const fsUniformsViews = {
				replaceableColor: new Float32Array(fsUniformsValues, 0, 3),
				replaceableType: new Uint32Array(fsUniformsValues, 12, 1),
				discardAlphaLevel: new Float32Array(fsUniformsValues, 16, 1)
			};
			fsUniformsViews.replaceableColor.set(this.rendererData.teamColor);
			fsUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
			if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) fsUniformsViews.discardAlphaLevel.set([DISCARD_ALPHA_KEY_LEVEL]);
			else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate || emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x) fsUniformsViews.discardAlphaLevel.set([DISCARD_MODULATE_LEVEL]);
			else fsUniformsViews.discardAlphaLevel.set([0]);
			if (!emitter.fsUniformsBuffer) emitter.fsUniformsBuffer = this.device.createBuffer({
				label: `particles fs uniforms ${emitter.index}`,
				size: 32,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.device.queue.writeBuffer(emitter.fsUniformsBuffer, 0, fsUniformsValues);
			const fsUniformsBindGroup = this.device.createBindGroup({
				label: `particles fs uniforms ${emitter.index}`,
				layout: this.fsBindGroupLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: emitter.fsUniformsBuffer }
					},
					{
						binding: 1,
						resource: this.rendererData.gpuSamplers[textureID]
					},
					{
						binding: 2,
						resource: (this.rendererData.gpuTextures[texture.Image] || this.rendererData.gpuEmptyTexture).createView()
					}
				]
			});
			pass.setBindGroup(1, fsUniformsBindGroup);
			this.device.queue.writeBuffer(emitter.colorGPUBuffer, 0, emitter.colors);
			this.device.queue.writeBuffer(emitter.indexGPUBuffer, 0, emitter.indices);
			pass.setVertexBuffer(2, emitter.colorGPUBuffer);
			pass.setIndexBuffer(emitter.indexGPUBuffer, "uint16");
			if (emitter.type & ParticleEmitter2FramesFlags.Tail) this.renderGPUEmitterType(pass, emitter, ParticleEmitter2FramesFlags.Tail);
			if (emitter.type & ParticleEmitter2FramesFlags.Head) this.renderGPUEmitterType(pass, emitter, ParticleEmitter2FramesFlags.Head);
		}
	}
	updateEmitter(emitter, delta) {
		if (this.interp.animVectorVal(emitter.props.Visibility, 1) > 0) {
			if (emitter.props.Squirt && typeof emitter.props.EmissionRate !== "number") {
				const interp = this.interp.findKeyframes(emitter.props.EmissionRate);
				if (delta > 0 && interp && interp.left && interp.left.Frame !== emitter.squirtFrame) {
					emitter.squirtFrame = interp.left.Frame;
					if (interp.left.Vector[0] > 0) emitter.emission += interp.left.Vector[0] * 1e3;
				}
			} else {
				const emissionRate = this.interp.animVectorVal(emitter.props.EmissionRate, 0);
				emitter.emission += emissionRate * delta;
			}
			while (emitter.emission >= 1e3) {
				emitter.emission -= 1e3;
				emitter.particles.push(this.createParticle(emitter, this.rendererData.nodes[emitter.props.ObjectId].matrix));
			}
		}
		if (emitter.particles.length) {
			const updatedParticles = [];
			for (const particle of emitter.particles) {
				this.updateParticle(particle, delta);
				if (particle.lifeSpan > 0) updatedParticles.push(particle);
				else this.particleStorage.push(particle);
			}
			emitter.particles = updatedParticles;
			if (emitter.type & ParticleEmitter2FramesFlags.Head) if (emitter.props.Flags & ParticleEmitter2Flags.XYQuad) {
				set$2(this.particleBaseVectors[0], -1, 1, 0);
				set$2(this.particleBaseVectors[1], -1, -1, 0);
				set$2(this.particleBaseVectors[2], 1, 1, 0);
				set$2(this.particleBaseVectors[3], 1, -1, 0);
			} else {
				set$2(this.particleBaseVectors[0], 0, -1, 1);
				set$2(this.particleBaseVectors[1], 0, -1, -1);
				set$2(this.particleBaseVectors[2], 0, 1, 1);
				set$2(this.particleBaseVectors[3], 0, 1, -1);
				for (let i = 0; i < 4; ++i) transformQuat(this.particleBaseVectors[i], this.particleBaseVectors[i], this.rendererData.cameraQuat);
			}
			this.resizeEmitterBuffers(emitter, emitter.particles.length);
			for (let i = 0; i < emitter.particles.length; ++i) this.updateParticleBuffers(emitter.particles[i], i, emitter);
		}
	}
	createParticle(emitter, emitterMatrix) {
		let particle;
		if (this.particleStorage.length) particle = this.particleStorage.pop();
		else particle = {
			emitter: null,
			pos: create$2(),
			angle: 0,
			speed: create$2(),
			gravity: null,
			lifeSpan: null
		};
		const width = this.interp.animVectorVal(emitter.props.Width, 0);
		const length = this.interp.animVectorVal(emitter.props.Length, 0);
		let speedScale = this.interp.animVectorVal(emitter.props.Speed, 0);
		const variation = this.interp.animVectorVal(emitter.props.Variation, 0);
		const latitude = degToRad(this.interp.animVectorVal(emitter.props.Latitude, 0));
		particle.emitter = emitter;
		particle.pos[0] = emitter.props.PivotPoint[0] + rand(-width, width);
		particle.pos[1] = emitter.props.PivotPoint[1] + rand(-length, length);
		particle.pos[2] = emitter.props.PivotPoint[2];
		transformMat4(particle.pos, particle.pos, emitterMatrix);
		if (variation > 0) speedScale *= 1 + rand(-variation, variation);
		set$2(particle.speed, 0, 0, speedScale);
		particle.angle = rand(0, Math.PI * 2);
		rotateY(particle.speed, particle.speed, rotateCenter, rand(0, latitude));
		rotateZ(particle.speed, particle.speed, rotateCenter, particle.angle);
		if (emitter.props.Flags & ParticleEmitter2Flags.LineEmitter) particle.speed[0] = 0;
		transformMat4(particle.speed, particle.speed, emitterMatrix);
		particle.speed[0] -= emitterMatrix[12];
		particle.speed[1] -= emitterMatrix[13];
		particle.speed[2] -= emitterMatrix[14];
		particle.gravity = this.interp.animVectorVal(emitter.props.Gravity, 0);
		particle.lifeSpan = emitter.props.LifeSpan;
		return particle;
	}
	updateParticleBuffers(particle, index, emitter) {
		const globalT = 1 - particle.lifeSpan / emitter.props.LifeSpan;
		const firstHalf = globalT < emitter.props.Time;
		let t;
		if (firstHalf) t = globalT / emitter.props.Time;
		else t = (globalT - emitter.props.Time) / (1 - emitter.props.Time);
		this.updateParticleVertices(particle, index, emitter, firstHalf, t);
		this.updateParticleTexCoords(index, emitter, firstHalf, t);
		this.updateParticleColor(index, emitter, firstHalf, t);
	}
	updateParticleVertices(particle, index, emitter, firstHalf, t) {
		let firstScale;
		let secondScale;
		let scale;
		if (firstHalf) {
			firstScale = emitter.props.ParticleScaling[0];
			secondScale = emitter.props.ParticleScaling[1];
		} else {
			firstScale = emitter.props.ParticleScaling[1];
			secondScale = emitter.props.ParticleScaling[2];
		}
		scale = lerp(firstScale, secondScale, t);
		if (emitter.type & ParticleEmitter2FramesFlags.Head) for (let i = 0; i < 4; ++i) {
			emitter.headVertices[index * 12 + i * 3] = this.particleBaseVectors[i][0] * scale;
			emitter.headVertices[index * 12 + i * 3 + 1] = this.particleBaseVectors[i][1] * scale;
			emitter.headVertices[index * 12 + i * 3 + 2] = this.particleBaseVectors[i][2] * scale;
			if (emitter.props.Flags & ParticleEmitter2Flags.XYQuad) {
				const x = emitter.headVertices[index * 12 + i * 3];
				const y = emitter.headVertices[index * 12 + i * 3 + 1];
				emitter.headVertices[index * 12 + i * 3] = x * Math.cos(particle.angle) - y * Math.sin(particle.angle);
				emitter.headVertices[index * 12 + i * 3 + 1] = x * Math.sin(particle.angle) + y * Math.cos(particle.angle);
			}
		}
		if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
			tailPos[0] = -particle.speed[0] * emitter.props.TailLength;
			tailPos[1] = -particle.speed[1] * emitter.props.TailLength;
			tailPos[2] = -particle.speed[2] * emitter.props.TailLength;
			cross(tailCross, particle.speed, this.rendererData.cameraPos);
			normalize$2(tailCross, tailCross);
			scale$2(tailCross, tailCross, scale);
			emitter.tailVertices[index * 12] = tailCross[0];
			emitter.tailVertices[index * 12 + 1] = tailCross[1];
			emitter.tailVertices[index * 12 + 2] = tailCross[2];
			emitter.tailVertices[index * 12 + 3] = -tailCross[0];
			emitter.tailVertices[index * 12 + 3 + 1] = -tailCross[1];
			emitter.tailVertices[index * 12 + 3 + 2] = -tailCross[2];
			emitter.tailVertices[index * 12 + 6] = tailCross[0] + tailPos[0];
			emitter.tailVertices[index * 12 + 6 + 1] = tailCross[1] + tailPos[1];
			emitter.tailVertices[index * 12 + 6 + 2] = tailCross[2] + tailPos[2];
			emitter.tailVertices[index * 12 + 9] = -tailCross[0] + tailPos[0];
			emitter.tailVertices[index * 12 + 9 + 1] = -tailCross[1] + tailPos[1];
			emitter.tailVertices[index * 12 + 9 + 2] = -tailCross[2] + tailPos[2];
		}
		for (let i = 0; i < 4; ++i) {
			if (emitter.headVertices) {
				emitter.headVertices[index * 12 + i * 3] += particle.pos[0];
				emitter.headVertices[index * 12 + i * 3 + 1] += particle.pos[1];
				emitter.headVertices[index * 12 + i * 3 + 2] += particle.pos[2];
			}
			if (emitter.tailVertices) {
				emitter.tailVertices[index * 12 + i * 3] += particle.pos[0];
				emitter.tailVertices[index * 12 + i * 3 + 1] += particle.pos[1];
				emitter.tailVertices[index * 12 + i * 3 + 2] += particle.pos[2];
			}
		}
	}
	updateParticleTexCoords(index, emitter, firstHalf, t) {
		if (emitter.type & ParticleEmitter2FramesFlags.Head) this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2FramesFlags.Head);
		if (emitter.type & ParticleEmitter2FramesFlags.Tail) this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2FramesFlags.Tail);
	}
	updateParticleTexCoordsByType(index, emitter, firstHalf, t, type) {
		let uvAnim;
		let texCoords;
		if (type === ParticleEmitter2FramesFlags.Tail) {
			uvAnim = firstHalf ? emitter.props.TailUVAnim : emitter.props.TailDecayUVAnim;
			texCoords = emitter.tailTexCoords;
		} else {
			uvAnim = firstHalf ? emitter.props.LifeSpanUVAnim : emitter.props.DecayUVAnim;
			texCoords = emitter.headTexCoords;
		}
		const firstFrame = uvAnim[0];
		const secondFrame = uvAnim[1];
		const frame = Math.round(lerp(firstFrame, secondFrame, t)) % (emitter.props.Rows * emitter.props.Columns);
		const texCoordX = frame % emitter.props.Columns;
		const texCoordY = Math.floor(frame / emitter.props.Columns);
		const cellWidth = 1 / emitter.props.Columns;
		const cellHeight = 1 / emitter.props.Rows;
		texCoords[index * 8] = texCoordX * cellWidth;
		texCoords[index * 8 + 1] = texCoordY * cellHeight;
		texCoords[index * 8 + 2] = texCoordX * cellWidth;
		texCoords[index * 8 + 3] = (1 + texCoordY) * cellHeight;
		texCoords[index * 8 + 4] = (1 + texCoordX) * cellWidth;
		texCoords[index * 8 + 5] = texCoordY * cellHeight;
		texCoords[index * 8 + 6] = (1 + texCoordX) * cellWidth;
		texCoords[index * 8 + 7] = (1 + texCoordY) * cellHeight;
	}
	updateParticleColor(index, emitter, firstHalf, t) {
		if (firstHalf) {
			firstColor[0] = emitter.props.SegmentColor[0][0];
			firstColor[1] = emitter.props.SegmentColor[0][1];
			firstColor[2] = emitter.props.SegmentColor[0][2];
			firstColor[3] = emitter.props.Alpha[0] / 255;
			secondColor[0] = emitter.props.SegmentColor[1][0];
			secondColor[1] = emitter.props.SegmentColor[1][1];
			secondColor[2] = emitter.props.SegmentColor[1][2];
			secondColor[3] = emitter.props.Alpha[1] / 255;
		} else {
			firstColor[0] = emitter.props.SegmentColor[1][0];
			firstColor[1] = emitter.props.SegmentColor[1][1];
			firstColor[2] = emitter.props.SegmentColor[1][2];
			firstColor[3] = emitter.props.Alpha[1] / 255;
			secondColor[0] = emitter.props.SegmentColor[2][0];
			secondColor[1] = emitter.props.SegmentColor[2][1];
			secondColor[2] = emitter.props.SegmentColor[2][2];
			secondColor[3] = emitter.props.Alpha[2] / 255;
		}
		lerp$2(color, firstColor, secondColor, t);
		for (let i = 0; i < 4; ++i) {
			emitter.colors[index * 16 + i * 4] = color[0];
			emitter.colors[index * 16 + i * 4 + 1] = color[1];
			emitter.colors[index * 16 + i * 4 + 2] = color[2];
			emitter.colors[index * 16 + i * 4 + 3] = color[3];
		}
	}
	setLayerProps(emitter) {
		if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DISCARD_ALPHA_KEY_LEVEL);
		else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate || emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x) this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DISCARD_MODULATE_LEVEL);
		else this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
		if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Blend) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
			this.gl.depthMask(false);
		} else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Additive) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.ZERO, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
			this.gl.depthMask(false);
		}
		const texture = this.rendererData.model.Textures[emitter.props.TextureID];
		if (texture.Image) {
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texture.Image]);
			this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
		} else if (texture.ReplaceableId === 1 || texture.ReplaceableId === 2) {
			this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
		}
	}
	setGeneralBuffers(emitter) {
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.colorBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.colors, this.gl.DYNAMIC_DRAW);
		this.gl.vertexAttribPointer(this.shaderProgramLocations.colorAttribute, 4, this.gl.FLOAT, false, 0, 0);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indices, this.gl.DYNAMIC_DRAW);
	}
	renderEmitterType(emitter, type) {
		if (type === ParticleEmitter2FramesFlags.Tail) {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailTexCoordBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailTexCoords, this.gl.DYNAMIC_DRAW);
		} else {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headTexCoordBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headTexCoords, this.gl.DYNAMIC_DRAW);
		}
		this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);
		if (type === ParticleEmitter2FramesFlags.Tail) {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailVertexBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailVertices, this.gl.DYNAMIC_DRAW);
		} else {
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headVertexBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headVertices, this.gl.DYNAMIC_DRAW);
		}
		this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
		this.gl.drawElements(this.gl.TRIANGLES, emitter.particles.length * 6, this.gl.UNSIGNED_SHORT, 0);
	}
};
//#endregion
//#region renderer/layerOpacity.ts
var ZERO = 0, ONE = 1, SRC_COLOR = 768, SRC_ALPHA = 770, ONE_MINUS_SRC_ALPHA = 771, DST_COLOR = 774;
/** GL blend factors [source RGB, destination RGB, source alpha, destination alpha] for a layer's filter mode; None draws without blending. */
function layerBlendFactors(filterMode) {
	switch (filterMode) {
		case FilterMode.Transparent:
		case FilterMode.Blend: return [
			SRC_ALPHA,
			ONE_MINUS_SRC_ALPHA,
			ONE,
			ONE_MINUS_SRC_ALPHA
		];
		case FilterMode.Additive:
		case FilterMode.AddAlpha: return [
			SRC_ALPHA,
			ONE,
			SRC_ALPHA,
			ONE
		];
		case FilterMode.Modulate: return [
			ZERO,
			SRC_COLOR,
			ZERO,
			ONE
		];
		case FilterMode.Modulate2x: return [
			DST_COLOR,
			SRC_COLOR,
			ZERO,
			ONE
		];
		default: return null;
	}
}
/** A layer fragment's alpha: its geoset's alpha times its own times the model's (an effect's alpha), whatever its filter mode. */
function layerOpacity(geosetAlpha, layerAlpha, instanceAlpha) {
	return geosetAlpha * layerAlpha * instanceAlpha;
}
//#endregion
//#region renderer/shaders/webgl/ribbon.vs.glsl?raw
var ribbon_vs_default = "attribute vec3 aVertexPosition;\nattribute vec2 aTextureCoord;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec2 vTextureCoord;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n}\n";
//#endregion
//#region renderer/shaders/webgl/ribbon.fs.glsl?raw
var ribbon_fs_default = "precision mediump float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uSampler;\nuniform vec3 uReplaceableColor;\nuniform float uReplaceableType;\nuniform float uDiscardAlphaLevel;\nuniform vec4 uColor;\n\nfloat hypot (vec2 z) {\n    float t;\n    float x = abs(z.x);\n    float y = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    return (z.x == 0.0 && z.y == 0.0) ? 0.0 : x * sqrt(1.0 + t * t);\n}\n\nvoid main(void) {\n    vec2 coords = vec2(vTextureCoord.s, vTextureCoord.t);\n    if (uReplaceableType == 0.) {\n        gl_FragColor = texture2D(uSampler, coords);\n    } else if (uReplaceableType == 1.) {\n        gl_FragColor = vec4(uReplaceableColor, 1.0);\n    } else if (uReplaceableType == 2.) {\n        float dist = hypot(coords - vec2(0.5, 0.5)) * 2.;\n        float truncateDist = clamp(1. - dist * 1.4, 0., 1.);\n        float alpha = sin(truncateDist);\n        gl_FragColor = vec4(uReplaceableColor * alpha, 1.0);\n    }\n    gl_FragColor *= uColor;\n\n    if (gl_FragColor[3] < uDiscardAlphaLevel) {\n        discard;\n    }\n}\n";
//#endregion
//#region renderer/shaders/webgpu/ribbons.wgsl?raw
var ribbons_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\nstruct FSUniforms {\n    replaceableColor: vec3f,\n    replaceableType: u32,\n    discardAlphaLevel: f32,\n    color: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformSampler: sampler;\n@group(1) @binding(2) var fsUniformTexture: texture_2d<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) textureCoord: vec2f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) textureCoord: vec2f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.textureCoord = in.textureCoord;\n    return out;\n}\n\nfn hypot(z: vec2f) -> f32 {\n    var t: f32 = 0;\n    var x: f32 = abs(z.x);\n    let y: f32 = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    if (z.x == 0.0 && z.y == 0.0) {\n        return 0.0;\n    }\n    return x * sqrt(1.0 + t * t);\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    let texCoord: vec2f = in.textureCoord;\n    var color: vec4f = vec4f(0.0);\n\n    if (fsUniforms.replaceableType == 0) {\n        color = textureSample(fsUniformTexture, fsUniformSampler, texCoord);\n    } else if (fsUniforms.replaceableType == 1) {\n        color = vec4f(fsUniforms.replaceableColor, 1.0);\n    } else if (fsUniforms.replaceableType == 2) {\n        let dist: f32 = hypot(texCoord - vec2(0.5, 0.5)) * 2.;\n        let truncateDist: f32 = clamp(1. - dist * 1.4, 0., 1.);\n        let alpha: f32 = sin(truncateDist);\n        color = vec4f(fsUniforms.replaceableColor * alpha, 1.0);\n    }\n\n    color *= fsUniforms.color;\n\n    // hand-made alpha-test\n    if (color.a < fsUniforms.discardAlphaLevel) {\n        discard;\n    }\n\n    return color;\n}\n";
//#endregion
//#region renderer/ribbons.ts
var RibbonsController = class {
	constructor(interp, rendererData) {
		this.shaderProgramLocations = {
			vertexPositionAttribute: null,
			textureCoordAttribute: null,
			pMatrixUniform: null,
			mvMatrixUniform: null,
			samplerUniform: null,
			replaceableColorUniform: null,
			replaceableTypeUniform: null,
			discardAlphaLevelUniform: null,
			colorUniform: null
		};
		this.interp = interp;
		this.rendererData = rendererData;
		this.emitters = [];
		if (rendererData.model.RibbonEmitters.length) for (let i = 0; i < rendererData.model.RibbonEmitters.length; ++i) {
			const ribbonEmitter = rendererData.model.RibbonEmitters[i];
			const emitter = {
				index: i,
				emission: 0,
				props: ribbonEmitter,
				capacity: 0,
				baseCapacity: 0,
				creationTimes: [],
				vertices: null,
				vertexBuffer: null,
				vertexGPUBuffer: null,
				texCoords: null,
				texCoordBuffer: null,
				texCoordGPUBuffer: null,
				fsUnifrmsPerLayer: []
			};
			emitter.baseCapacity = Math.ceil(ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * emitter.props.LifeSpan) + 1;
			this.emitters.push(emitter);
		}
	}
	destroy() {
		if (this.shaderProgram) {
			if (this.vertexShader) {
				this.gl.detachShader(this.shaderProgram, this.vertexShader);
				this.gl.deleteShader(this.vertexShader);
				this.vertexShader = null;
			}
			if (this.fragmentShader) {
				this.gl.detachShader(this.shaderProgram, this.fragmentShader);
				this.gl.deleteShader(this.fragmentShader);
				this.fragmentShader = null;
			}
			this.gl.deleteProgram(this.shaderProgram);
			this.shaderProgram = null;
		}
		if (this.gpuVSUniformsBuffer) {
			this.gpuVSUniformsBuffer.destroy();
			this.gpuVSUniformsBuffer = null;
		}
		for (const emitter of this.emitters) for (const buffer of emitter.fsUnifrmsPerLayer) buffer.destroy();
		this.emitters = [];
	}
	initGL(glContext) {
		this.gl = glContext;
		this.initShaders();
	}
	initGPUDevice(device) {
		this.device = device;
		this.gpuShaderModule = device.createShaderModule({
			label: "ribbons shader module",
			code: ribbons_default
		});
		this.vsBindGroupLayout = this.device.createBindGroupLayout({
			label: "ribbons vs bind group layout",
			entries: [{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: {
					type: "uniform",
					hasDynamicOffset: false,
					minBindingSize: 128
				}
			}]
		});
		this.fsBindGroupLayout = this.device.createBindGroupLayout({
			label: "ribbons bind group layout2",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {
						type: "uniform",
						hasDynamicOffset: false,
						minBindingSize: 48
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				}
			]
		});
		this.gpuPipelineLayout = this.device.createPipelineLayout({
			label: "ribbons pipeline layout",
			bindGroupLayouts: [this.vsBindGroupLayout, this.fsBindGroupLayout]
		});
		const createPipeline = (name, blend, depth) => {
			return device.createRenderPipeline({
				label: `ribbons pipeline ${name}`,
				layout: this.gpuPipelineLayout,
				vertex: {
					module: this.gpuShaderModule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}, {
						arrayStride: 8,
						attributes: [{
							shaderLocation: 1,
							offset: 0,
							format: "float32x2"
						}]
					}]
				},
				fragment: {
					module: this.gpuShaderModule,
					targets: [{
						format: navigator.gpu.getPreferredCanvasFormat(),
						blend
					}]
				},
				depthStencil: depth,
				primitive: { topology: "triangle-strip" }
			});
		};
		this.gpuPipelines = [
			createPipeline("none", {
				color: {
					operation: "add",
					srcFactor: "one",
					dstFactor: "zero"
				},
				alpha: {
					operation: "add",
					srcFactor: "one",
					dstFactor: "zero"
				}
			}, {
				depthWriteEnabled: true,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("transparent", {
				color: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha"
				},
				alpha: {
					operation: "add",
					srcFactor: "one",
					dstFactor: "one-minus-src-alpha"
				}
			}, {
				depthWriteEnabled: true,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("blend", {
				color: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha"
				},
				alpha: {
					operation: "add",
					srcFactor: "one",
					dstFactor: "one-minus-src-alpha"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("additive", {
				color: {
					operation: "add",
					srcFactor: "src",
					dstFactor: "one"
				},
				alpha: {
					operation: "add",
					srcFactor: "src",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("addAlpha", {
				color: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one"
				},
				alpha: {
					operation: "add",
					srcFactor: "src-alpha",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("modulate", {
				color: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "src"
				},
				alpha: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			}),
			createPipeline("modulate2x", {
				color: {
					operation: "add",
					srcFactor: "dst",
					dstFactor: "src"
				},
				alpha: {
					operation: "add",
					srcFactor: "zero",
					dstFactor: "one"
				}
			}, {
				depthWriteEnabled: false,
				depthCompare: "less-equal",
				format: "depth24plus"
			})
		];
		this.gpuVSUniformsBuffer = this.device.createBuffer({
			label: "ribbons vs uniforms",
			size: 128,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.gpuVSUniformsBindGroup = this.device.createBindGroup({
			layout: this.vsBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: this.gpuVSUniformsBuffer }
			}]
		});
	}
	update(delta) {
		for (const emitter of this.emitters) this.updateEmitter(emitter, delta);
	}
	render(mvMatrix, pMatrix) {
		this.gl.useProgram(this.shaderProgram);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
		for (const emitter of this.emitters) {
			if (emitter.creationTimes.length < 2) continue;
			this.gl.uniform4f(this.shaderProgramLocations.colorUniform, emitter.props.Color[0], emitter.props.Color[1], emitter.props.Color[2], this.interp.animVectorVal(emitter.props.Alpha, 1));
			this.setGeneralBuffers(emitter);
			const materialID = emitter.props.MaterialID;
			const material = this.rendererData.model.Materials[materialID];
			for (let j = 0; j < material.Layers.length; ++j) {
				this.setLayerProps(material.Layers[j], this.rendererData.materialLayerTextureID[materialID][j]);
				this.renderEmitter(emitter);
			}
		}
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
	}
	renderGPU(pass, mvMatrix, pMatrix) {
		const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
		const VSUniformsViews = {
			mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
			pMatrix: new Float32Array(VSUniformsValues, 64, 16)
		};
		VSUniformsViews.mvMatrix.set(mvMatrix);
		VSUniformsViews.pMatrix.set(pMatrix);
		this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);
		for (const emitter of this.emitters) {
			if (emitter.creationTimes.length < 2) continue;
			this.device.queue.writeBuffer(emitter.vertexGPUBuffer, 0, emitter.vertices);
			this.device.queue.writeBuffer(emitter.texCoordGPUBuffer, 0, emitter.texCoords);
			pass.setVertexBuffer(0, emitter.vertexGPUBuffer);
			pass.setVertexBuffer(1, emitter.texCoordGPUBuffer);
			pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
			const materialID = emitter.props.MaterialID;
			const material = this.rendererData.model.Materials[materialID];
			for (let j = 0; j < material.Layers.length; ++j) {
				const textureID = this.rendererData.materialLayerTextureID[materialID][j];
				const texture = this.rendererData.model.Textures[textureID];
				const layer = material.Layers[j];
				const pipeline = this.gpuPipelines[layer.FilterMode] || this.gpuPipelines[0];
				pass.setPipeline(pipeline);
				const fsUniformsValues = /* @__PURE__ */ new ArrayBuffer(48);
				const fsUniformsViews = {
					replaceableColor: new Float32Array(fsUniformsValues, 0, 3),
					replaceableType: new Uint32Array(fsUniformsValues, 12, 1),
					discardAlphaLevel: new Float32Array(fsUniformsValues, 16, 1),
					color: new Float32Array(fsUniformsValues, 32, 4)
				};
				fsUniformsViews.replaceableColor.set(this.rendererData.teamColor);
				fsUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
				fsUniformsViews.discardAlphaLevel.set([layer.FilterMode === FilterMode.Transparent ? .75 : 0]);
				fsUniformsViews.color.set([
					emitter.props.Color[0],
					emitter.props.Color[1],
					emitter.props.Color[2],
					this.interp.animVectorVal(emitter.props.Alpha, 1)
				]);
				if (!emitter.fsUnifrmsPerLayer[j]) emitter.fsUnifrmsPerLayer[j] = this.device.createBuffer({
					label: `ribbons fs uniforms ${emitter.index} layer ${j}`,
					size: 48,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				});
				const fsUniformsBuffer = emitter.fsUnifrmsPerLayer[j];
				this.device.queue.writeBuffer(fsUniformsBuffer, 0, fsUniformsValues);
				const fsUniformsBindGroup = this.device.createBindGroup({
					label: `ribbons fs uniforms ${emitter.index}`,
					layout: this.fsBindGroupLayout,
					entries: [
						{
							binding: 0,
							resource: { buffer: fsUniformsBuffer }
						},
						{
							binding: 1,
							resource: this.rendererData.gpuSamplers[textureID]
						},
						{
							binding: 2,
							resource: (this.rendererData.gpuTextures[texture.Image] || this.rendererData.gpuEmptyTexture).createView()
						}
					]
				});
				pass.setBindGroup(1, fsUniformsBindGroup);
				pass.draw(emitter.creationTimes.length * 2);
			}
		}
	}
	initShaders() {
		const vertex = this.vertexShader = getShader(this.gl, ribbon_vs_default, this.gl.VERTEX_SHADER);
		const fragment = this.fragmentShader = getShader(this.gl, ribbon_fs_default, this.gl.FRAGMENT_SHADER);
		const shaderProgram = this.shaderProgram = this.gl.createProgram();
		this.gl.attachShader(shaderProgram, vertex);
		this.gl.attachShader(shaderProgram, fragment);
		this.gl.linkProgram(shaderProgram);
		if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) alert("Could not initialise shaders");
		this.gl.useProgram(shaderProgram);
		this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, "aVertexPosition");
		this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(shaderProgram, "aTextureCoord");
		this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uPMatrix");
		this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uMVMatrix");
		this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, "uSampler");
		this.shaderProgramLocations.replaceableColorUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableColor");
		this.shaderProgramLocations.replaceableTypeUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableType");
		this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(shaderProgram, "uDiscardAlphaLevel");
		this.shaderProgramLocations.colorUniform = this.gl.getUniformLocation(shaderProgram, "uColor");
	}
	resizeEmitterBuffers(emitter, size) {
		if (size <= emitter.capacity) return;
		size = Math.min(size, emitter.baseCapacity);
		const vertices = new Float32Array(size * 2 * 3);
		const texCoords = new Float32Array(size * 2 * 2);
		if (emitter.vertices) vertices.set(emitter.vertices);
		emitter.vertices = vertices;
		emitter.texCoords = texCoords;
		emitter.capacity = size;
		if (this.gl) {
			if (!emitter.vertexBuffer) {
				emitter.vertexBuffer = this.gl.createBuffer();
				emitter.texCoordBuffer = this.gl.createBuffer();
			}
		} else if (this.device) {
			emitter.vertexGPUBuffer?.destroy();
			emitter.texCoordGPUBuffer?.destroy();
			emitter.vertexGPUBuffer = this.device.createBuffer({
				label: `ribbon vertex buffer ${emitter.index}`,
				size: vertices.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
			});
			emitter.texCoordGPUBuffer = this.device.createBuffer({
				label: `ribbon texCoord buffer ${emitter.index}`,
				size: texCoords.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
			});
		}
	}
	updateEmitter(emitter, delta) {
		const now = Date.now();
		if (this.interp.animVectorVal(emitter.props.Visibility, 0) > 0) {
			const emissionRate = emitter.props.EmissionRate;
			emitter.emission += emissionRate * delta;
			if (emitter.emission >= 1e3) {
				emitter.emission = emitter.emission % 1e3;
				if (emitter.creationTimes.length + 1 > emitter.capacity) this.resizeEmitterBuffers(emitter, emitter.creationTimes.length + 1);
				this.appendVertices(emitter);
				emitter.creationTimes.push(now);
			}
		}
		if (emitter.creationTimes.length) while (emitter.creationTimes[0] + emitter.props.LifeSpan * 1e3 < now) {
			emitter.creationTimes.shift();
			for (let i = 0; i + 6 + 5 < emitter.vertices.length; i += 6) {
				emitter.vertices[i] = emitter.vertices[i + 6];
				emitter.vertices[i + 1] = emitter.vertices[i + 7];
				emitter.vertices[i + 2] = emitter.vertices[i + 8];
				emitter.vertices[i + 3] = emitter.vertices[i + 9];
				emitter.vertices[i + 4] = emitter.vertices[i + 10];
				emitter.vertices[i + 5] = emitter.vertices[i + 11];
			}
		}
		if (emitter.creationTimes.length) this.updateEmitterTexCoords(emitter, now);
	}
	appendVertices(emitter) {
		const first = clone$2(emitter.props.PivotPoint);
		const second = clone$2(emitter.props.PivotPoint);
		first[1] -= this.interp.animVectorVal(emitter.props.HeightBelow, 0);
		second[1] += this.interp.animVectorVal(emitter.props.HeightAbove, 0);
		const emitterMatrix = this.rendererData.nodes[emitter.props.ObjectId].matrix;
		transformMat4(first, first, emitterMatrix);
		transformMat4(second, second, emitterMatrix);
		const currentSize = emitter.creationTimes.length;
		emitter.vertices[currentSize * 6] = first[0];
		emitter.vertices[currentSize * 6 + 1] = first[1];
		emitter.vertices[currentSize * 6 + 2] = first[2];
		emitter.vertices[currentSize * 6 + 3] = second[0];
		emitter.vertices[currentSize * 6 + 4] = second[1];
		emitter.vertices[currentSize * 6 + 5] = second[2];
	}
	updateEmitterTexCoords(emitter, now) {
		for (let i = 0; i < emitter.creationTimes.length; ++i) {
			let relativePos = (now - emitter.creationTimes[i]) / (emitter.props.LifeSpan * 1e3);
			const textureSlot = this.interp.animVectorVal(emitter.props.TextureSlot, 0);
			const texCoordX = textureSlot % emitter.props.Columns;
			const texCoordY = Math.floor(textureSlot / emitter.props.Rows);
			const cellWidth = 1 / emitter.props.Columns;
			const cellHeight = 1 / emitter.props.Rows;
			relativePos = texCoordX * cellWidth + relativePos * cellWidth;
			emitter.texCoords[i * 2 * 2] = relativePos;
			emitter.texCoords[i * 2 * 2 + 1] = texCoordY * cellHeight;
			emitter.texCoords[i * 2 * 2 + 2] = relativePos;
			emitter.texCoords[i * 2 * 2 + 3] = (1 + texCoordY) * cellHeight;
		}
	}
	setLayerProps(layer, textureID) {
		const texture = this.rendererData.model.Textures[textureID];
		if (layer.Shading & LayerShading.TwoSided) this.gl.disable(this.gl.CULL_FACE);
		else this.gl.enable(this.gl.CULL_FACE);
		if (layer.FilterMode === FilterMode.Transparent) this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, .75);
		else this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
		if (layer.FilterMode === FilterMode.None) {
			this.gl.disable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.depthMask(true);
		} else if (layer.FilterMode === FilterMode.Transparent) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
			this.gl.depthMask(true);
		} else if (layer.FilterMode === FilterMode.Blend) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Additive) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFunc(this.gl.SRC_COLOR, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.AddAlpha) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Modulate) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.ZERO, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Modulate2x) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
			this.gl.depthMask(false);
		}
		if (texture.Image) {
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texture.Image]);
			this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
		} else if (texture.ReplaceableId === 1 || texture.ReplaceableId === 2) {
			this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
		}
		if (layer.Shading & LayerShading.NoDepthTest) this.gl.disable(this.gl.DEPTH_TEST);
		if (layer.Shading & LayerShading.NoDepthSet) this.gl.depthMask(false);
	}
	setGeneralBuffers(emitter) {
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.texCoordBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.texCoords, this.gl.DYNAMIC_DRAW);
		this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.vertices, this.gl.DYNAMIC_DRAW);
		this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
	}
	renderEmitter(emitter) {
		this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, emitter.creationTimes.length * 2);
	}
};
//#endregion
//#region renderer/shaders/webgl/sdHardwareSkinning.vs.glsl?raw
var sdHardwareSkinning_vs_default = "attribute vec3 aVertexPosition;\nattribute vec3 aNormal;\nattribute vec2 aTextureCoord;\nattribute vec4 aGroup;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\nuniform mat4 uNodesMatrices[${MAX_NODES}];\n\nvarying vec3 vNormal;\nvarying vec2 vTextureCoord;\nvarying vec3 vFragPos;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    int count = 1;\n    vec4 sum = uNodesMatrices[int(aGroup[0])] * position;\n\n    if (aGroup[1] < ${MAX_NODES}.) {\n        sum += uNodesMatrices[int(aGroup[1])] * position;\n        count += 1;\n    }\n    if (aGroup[2] < ${MAX_NODES}.) {\n        sum += uNodesMatrices[int(aGroup[2])] * position;\n        count += 1;\n    }\n    if (aGroup[3] < ${MAX_NODES}.) {\n        sum += uNodesMatrices[int(aGroup[3])] * position;\n        count += 1;\n    }\n    sum.xyz /= float(count);\n    sum.w = 1.;\n    position = sum;\n\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n    vNormal = aNormal;\n    vFragPos = position.xyz;\n}";
//#endregion
//#region renderer/shaders/webgl/sdSoftwareSkinning.vs.glsl?raw
var sdSoftwareSkinning_vs_default = "attribute vec3 aVertexPosition;\nattribute vec3 aNormal;\nattribute vec2 aTextureCoord;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec3 vNormal;\nvarying vec2 vTextureCoord;\nvarying vec3 vFragPos;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n    vNormal = aNormal;\n    vFragPos = position.xyz;\n}";
//#endregion
//#region renderer/shaders/webgl/sd.fs.glsl?raw
const wispWhite = new Float32Array([1, 1, 1]), wispGeosetColor = new Float32Array(3);
var sd_fs_default = "precision mediump float;\n\nvarying vec3 vNormal;\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uSampler;\nuniform vec3 uReplaceableColor;\nuniform float uReplaceableType;\nuniform float uDiscardAlphaLevel;\nuniform float uLayerAlpha;\nuniform mat3 uTVertexAnim;\nuniform float uWireframe;\nuniform vec4 uWispLight;\nuniform vec3 uWispKey;\nuniform vec3 uWispAmbient;\nuniform vec4 uWispFog;\nuniform highp vec4 uWispFogRange;\nuniform float uWispFogMax;\nuniform vec3 uWispLayer;\nuniform vec3 uWispGeosetColor;\nuniform int uWispPointCount;\nuniform vec3 uWispPointPos[8];\nuniform vec3 uWispPointColor[8];\nuniform vec2 uWispPointRange[8];\nuniform mat4 uWispModel;\nuniform mat3 uWispNormal;\nvarying vec3 vFragPos;\nuniform highp sampler2D uWispShadowMap;\nuniform highp mat4 uWispShadowMatrix;\nuniform highp vec4 uWispShadow;\nuniform highp sampler2D uWispPointShadowMap;\nuniform highp mat4 uWispPointShadowMatrix[6];\nuniform vec2 uWispPointCaster;\nuniform highp vec3 uWispPointCasterPos[2];\nuniform highp vec4 uWispPointShadow;\n\nfloat wispSun(highp vec3 fragPos) {\n    if (uWispShadow.x < 0.5) return 1.;\n    highp vec4 at = uWispShadowMatrix * vec4(fragPos, 1.);\n    highp vec3 c = at.xyz / at.w * 0.5 + 0.5;\n    if (c.x <= 0. || c.x >= 1. || c.y <= 0. || c.y >= 1. || c.z >= 1.) return 1.;\n    float lit = 0.;\n    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {\n        lit += texture2D(uWispShadowMap, c.xy + vec2(float(dx), float(dy)) * uWispShadow.z).r >= c.z - uWispShadow.y ? 1. : 0.;\n    }\n    return lit / 9.;\n}\n\nfloat wispPointShadow(float slot, highp vec3 d) {\n    highp vec3 a = abs(d);\n    int face = a.x >= a.y && a.x >= a.z ? (d.x > 0. ? 0 : 1) : a.y >= a.z ? (d.y > 0. ? 2 : 3) : (d.z > 0. ? 4 : 5);\n    highp mat4 m = face == 0 ? uWispPointShadowMatrix[0] : face == 1 ? uWispPointShadowMatrix[1] : face == 2 ? uWispPointShadowMatrix[2] : face == 3 ? uWispPointShadowMatrix[3] : face == 4 ? uWispPointShadowMatrix[4] : uWispPointShadowMatrix[5];\n    highp vec4 at = m * vec4(d, 1.);\n    highp vec3 c = at.xyz / at.w * 0.5 + 0.5;\n    highp float near = uWispPointShadow.x, far = uWispPointShadow.y;\n    highp float own = 2. * near * far / (far + near - (2. * c.z - 1.) * (far - near));\n    if (own >= far) return 1.;\n    vec2 cell = vec2(mod(float(face), 3.), floor(float(face) / 3.) + 2. * slot);\n    float lit = 0.;\n    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {\n        highp vec2 inCell = clamp(c.xy + vec2(float(dx), float(dy)) * uWispPointShadow.z, uWispPointShadow.z, 1. - uWispPointShadow.z);\n        highp float stored = texture2D(uWispPointShadowMap, (cell + inCell) / vec2(3., 4.)).r;\n        highp float blocker = 2. * near * far / (far + near - (2. * stored - 1.) * (far - near));\n        lit += blocker >= own - (3. + own * 0.02) ? 1. : 0.;\n    }\n    return lit / 9.;\n}\n\nvec3 wispPoints(vec3 fragPos, vec3 normal) {\n    vec3 sum = vec3(0.);\n    if (uWispPointCount <= 0) return sum;\n    vec3 world = (uWispModel * vec4(fragPos, 1.)).xyz;\n    vec3 n = normalize(uWispNormal * normal);\n    float shade0 = uWispPointCaster.x < -0.5 ? 1. : wispPointShadow(0., world - uWispPointCasterPos[0]);\n    float shade1 = uWispPointCaster.y < -0.5 ? 1. : wispPointShadow(1., world - uWispPointCasterPos[1]);\n    for (int i = 0; i < 8; i++) {\n        if (i >= uWispPointCount) break;\n        vec3 toward = uWispPointPos[i] - world;\n        float dist = length(toward);\n        float reach = clamp((uWispPointRange[i].y - dist) / max(uWispPointRange[i].y - uWispPointRange[i].x, 1.), 0., 1.);\n        sum += uWispPointColor[i] * reach * max(dot(n, toward / max(dist, 1e-3)), 0.) * (float(i) == uWispPointCaster.x ? shade0 : float(i) == uWispPointCaster.y ? shade1 : 1.);\n    }\n    return sum;\n}\n\nfloat hypot (vec2 z) {\n    float t;\n    float x = abs(z.x);\n    float y = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    return (z.x == 0.0 && z.y == 0.0) ? 0.0 : x * sqrt(1.0 + t * t);\n}\n\nvoid main(void) {\n    if (uWireframe > 0.) {\n        gl_FragColor = vec4(1.);\n        return;\n    }\n\n    vec2 texCoord = (uTVertexAnim * vec3(vTextureCoord.s, vTextureCoord.t, 1.)).st;\n\n    if (uReplaceableType == 0.) {\n        gl_FragColor = texture2D(uSampler, texCoord);\n    } else if (uReplaceableType == 1.) {\n        gl_FragColor = vec4(uReplaceableColor, 1.0);\n    } else if (uReplaceableType == 2.) {\n        float dist = hypot(texCoord - vec2(0.5, 0.5)) * 2.;\n        float truncateDist = clamp(1. - dist * 1.4, 0., 1.);\n        float alpha = sin(truncateDist);\n        gl_FragColor = vec4(uReplaceableColor * alpha, 1.0);\n    }\n\n    gl_FragColor.rgb *= uWispGeosetColor;\n    gl_FragColor.a *= uLayerAlpha;\n    if (uWispLight.w > 0.5 && uWispLayer.x < 0.5) {\n        float wispLambert = max(dot(normalize(vNormal), uWispLight.xyz), 0.);\n        vec3 wispLit = clamp(uWispAmbient + uWispKey * wispLambert * wispSun(vFragPos) + wispPoints(vFragPos, vNormal), 0., 1.);\n        gl_FragColor.rgb *= uWispLight.w > 1.5 ? pow(wispLit, vec3(1. / 2.2)) : wispLit;\n    }\n    if (uWispFog.w > 0.5 && uWispLayer.y < 0.5) {\n        highp float wispDepth = uWispFogRange.z / max(1. - gl_FragCoord.z * uWispFogRange.w, 1e-6);\n        float wispFog = clamp((wispDepth - uWispFogRange.x) / max(uWispFogRange.y - uWispFogRange.x, 1.), 0., uWispFogMax);\n        gl_FragColor.rgb = mix(gl_FragColor.rgb, uWispLayer.z > 0.5 ? vec3(0.) : uWispFog.rgb, wispFog);\n    }\n\n    // hand-made alpha-test\n    if (gl_FragColor[3] < uDiscardAlphaLevel) {\n        discard;\n    }\n}\n";
//#endregion
//#region renderer/shaders/webgl/hdHardwareSkinningOld.vs.glsl?raw
var hdHardwareSkinningOld_vs_default = "attribute vec3 aVertexPosition;\nattribute vec3 aNormal;\nattribute vec2 aTextureCoord;\nattribute vec4 aSkin;\nattribute vec4 aBoneWeight;\nattribute vec4 aTangent;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\nuniform mat4 uNodesMatrices[${MAX_NODES}];\n\nvarying vec3 vNormal;\nvarying vec3 vTangent;\nvarying vec3 vBinormal;\nvarying vec2 vTextureCoord;\nvarying mat3 vTBN;\nvarying vec3 vFragPos;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    mat4 sum;\n\n    // sum += uNodesMatrices[int(aSkin[0])] * 1.;\n    sum += uNodesMatrices[int(aSkin[0])] * aBoneWeight[0];\n    sum += uNodesMatrices[int(aSkin[1])] * aBoneWeight[1];\n    sum += uNodesMatrices[int(aSkin[2])] * aBoneWeight[2];\n    sum += uNodesMatrices[int(aSkin[3])] * aBoneWeight[3];\n\n    mat3 rotation = mat3(sum);\n\n    position = sum * position;\n    position.w = 1.;\n\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n\n    vec3 normal = aNormal;\n    vec3 tangent = aTangent.xyz;\n\n    // https://learnopengl.com/Advanced-Lighting/Normal-Mapping\n    tangent = normalize(tangent - dot(tangent, normal) * normal);\n\n    vec3 binormal = cross(normal, tangent) * aTangent.w;\n\n    normal = normalize(rotation * normal);\n    tangent = normalize(rotation * tangent);\n    binormal = normalize(rotation * binormal);\n\n    vNormal = normal;\n    vTangent = tangent;\n    vBinormal = binormal;\n\n    vTBN = mat3(tangent, binormal, normal);\n\n    vFragPos = position.xyz;\n}";
//#endregion
//#region renderer/shaders/webgl/hdHardwareSkinningNew.vs.glsl?raw
var hdHardwareSkinningNew_vs_default = "#version 300 es\nin vec3 aVertexPosition;\nin vec3 aNormal;\nin vec2 aTextureCoord;\nin vec4 aSkin;\nin vec4 aBoneWeight;\nin vec4 aTangent;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\nuniform mat4 uNodesMatrices[${MAX_NODES}];\n\nout vec3 vNormal;\nout vec3 vTangent;\nout vec3 vBinormal;\nout vec2 vTextureCoord;\nout mat3 vTBN;\nout vec3 vFragPos;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    mat4 sum;\n\n    // sum += uNodesMatrices[int(aSkin[0])] * 1.;\n    sum += uNodesMatrices[int(aSkin[0])] * aBoneWeight[0];\n    sum += uNodesMatrices[int(aSkin[1])] * aBoneWeight[1];\n    sum += uNodesMatrices[int(aSkin[2])] * aBoneWeight[2];\n    sum += uNodesMatrices[int(aSkin[3])] * aBoneWeight[3];\n\n    mat3 rotation = mat3(sum);\n\n    position = sum * position;\n    position.w = 1.;\n\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vTextureCoord = aTextureCoord;\n\n    vec3 normal = aNormal;\n    vec3 tangent = aTangent.xyz;\n\n    // https://learnopengl.com/Advanced-Lighting/Normal-Mapping\n    tangent = normalize(tangent - dot(tangent, normal) * normal);\n\n    vec3 binormal = cross(normal, tangent) * aTangent.w;\n\n    normal = normalize(rotation * normal);\n    tangent = normalize(rotation * tangent);\n    binormal = normalize(rotation * binormal);\n\n    vNormal = normal;\n    vTangent = tangent;\n    vBinormal = binormal;\n\n    vTBN = mat3(tangent, binormal, normal);\n\n    vFragPos = position.xyz;\n}";
//#endregion
//#region renderer/shaders/webgl/hdOld.fs.glsl?raw
var hdOld_fs_default = "precision mediump float;\n\nvarying vec2 vTextureCoord;\nvarying vec3 vNormal;\nvarying vec3 vTangent;\nvarying vec3 vBinormal;\nvarying mat3 vTBN;\nvarying vec3 vFragPos;\n\nuniform sampler2D uSampler;\nuniform sampler2D uNormalSampler;\nuniform sampler2D uOrmSampler;\nuniform vec3 uReplaceableColor;\nuniform float uDiscardAlphaLevel;\nuniform float uLayerAlpha;\nuniform mat3 uTVertexAnim;\nuniform vec3 uLightPos;\nuniform vec3 uLightColor;\nuniform vec3 uCameraPos;\nuniform vec3 uShadowParams;\nuniform sampler2D uShadowMapSampler;\nuniform mat4 uShadowMapLightMatrix;\nuniform float uWireframe;\n\nconst float PI = 3.14159265359;\nconst float gamma = 2.2;\n\nfloat distributionGGX(vec3 normal, vec3 halfWay, float roughness) {\n    float a = roughness * roughness;\n    float a2 = a * a;\n    float nDotH = max(dot(normal, halfWay), 0.0);\n    float nDotH2 = nDotH * nDotH;\n\n    float num = a2;\n    float denom = (nDotH2 * (a2 - 1.0) + 1.0);\n    denom = PI * denom * denom;\n\n    return num / denom;\n}\n\nfloat geometrySchlickGGX(float nDotV, float roughness) {\n    float r = roughness + 1.;\n    float k = r * r / 8.;\n    // float k = roughness * roughness / 2.;\n\n    float num = nDotV;\n    float denom = nDotV * (1. - k) + k;\n\n    return num / denom;\n}\n\nfloat geometrySmith(vec3 normal, vec3 viewDir, vec3 lightDir, float roughness) {\n    float nDotV = max(dot(normal, viewDir), .0);\n    float nDotL = max(dot(normal, lightDir), .0);\n    float ggx2  = geometrySchlickGGX(nDotV, roughness);\n    float ggx1  = geometrySchlickGGX(nDotL, roughness);\n\n    return ggx1 * ggx2;\n}\n\nvec3 fresnelSchlick(float lightFactor, vec3 f0) {\n    return f0 + (1. - f0) * pow(clamp(1. - lightFactor, 0., 1.), 5.);\n}\n\nvoid main(void) {\n    if (uWireframe > 0.) {\n        gl_FragColor = vec4(1.);\n        return;\n    }\n\n    vec2 texCoord = (uTVertexAnim * vec3(vTextureCoord.s, vTextureCoord.t, 1.)).st;\n\n    vec4 orm = texture2D(uOrmSampler, texCoord);\n\n    float occlusion = orm.r;\n    float roughness = orm.g;\n    float metallic = orm.b;\n    float teamColorFactor = orm.a;\n\n    vec4 baseColor = texture2D(uSampler, texCoord);\n    vec3 teamColor = baseColor.rgb * uReplaceableColor;\n    baseColor.rgb = mix(baseColor.rgb, teamColor, teamColorFactor);\n    baseColor.rgb = pow(baseColor.rgb, vec3(gamma));\n\n    vec3 normal = texture2D(uNormalSampler, texCoord).rgb;\n    normal = normal * 2.0 - 1.0;\n    normal.x = -normal.x;\n    normal.y = -normal.y;\n    if (!gl_FrontFacing) {\n        normal = -normal;\n    }\n    normal = normalize(vTBN * -normal);\n\n    vec3 viewDir = normalize(uCameraPos - vFragPos);\n    vec3 reflected = reflect(-viewDir, normal);\n\n    vec3 lightDir = normalize(uLightPos - vFragPos);\n    float lightFactor = max(dot(normal, lightDir), .0);\n    vec3 radiance = uLightColor;\n\n    vec3 f0 = vec3(.04);\n    f0 = mix(f0, baseColor.rgb, metallic);\n\n    vec3 totalLight = vec3(0.);\n    vec3 halfWay = normalize(viewDir + lightDir);\n    float ndf = distributionGGX(normal, halfWay, roughness);\n    float g = geometrySmith(normal, viewDir, lightDir, roughness);\n    vec3 f = fresnelSchlick(max(dot(halfWay, viewDir), 0.), f0);\n\n    vec3 kS = f;\n    // vec3 kD = vec3(1.) - kS;\n    vec3 kD = vec3(1.);\n    // kD *= 1.0 - metallic;\n    vec3 num = ndf * g * f;\n    float denom = 4. * max(dot(normal, viewDir), 0.) * max(dot(normal, lightDir), 0.) + .0001;\n    vec3 specular = num / denom;\n\n    totalLight = (kD * baseColor.rgb / PI + specular) * radiance * lightFactor;\n\n    if (uShadowParams[0] > .5) {\n        float shadowBias = uShadowParams[1];\n        float shadowStep = uShadowParams[2];\n        vec4 fragInLightPos = uShadowMapLightMatrix * vec4(vFragPos, 1.);\n        vec3 shadowMapCoord = fragInLightPos.xyz / fragInLightPos.w;\n        shadowMapCoord.xyz = (shadowMapCoord.xyz + 1.0) * .5;\n\n        int passes = 5;\n        float step = 1. / float(passes);\n\n        float lightDepth = texture2D(uShadowMapSampler, shadowMapCoord.xy).r;\n        float lightDepth0 = texture2D(uShadowMapSampler, vec2(shadowMapCoord.x + shadowStep, shadowMapCoord.y)).r;\n        float lightDepth1 = texture2D(uShadowMapSampler, vec2(shadowMapCoord.x, shadowMapCoord.y + shadowStep)).r;\n        float lightDepth2 = texture2D(uShadowMapSampler, vec2(shadowMapCoord.x, shadowMapCoord.y - shadowStep)).r;\n        float lightDepth3 = texture2D(uShadowMapSampler, vec2(shadowMapCoord.x - shadowStep, shadowMapCoord.y)).r;\n        float currentDepth = shadowMapCoord.z;\n\n        float visibility = 0.;\n        if (lightDepth > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth0 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth1 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth2 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth3 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n\n        totalLight *= visibility;\n    }\n\n    vec3 color;\n\n    vec3 ambient = vec3(.03);\n    ambient *= baseColor.rgb * occlusion;\n    color = ambient + totalLight;\n\n    color = color / (vec3(1.) + color);\n    color = pow(color, vec3(1. / gamma));\n\n    gl_FragColor = vec4(color, uLayerAlpha);\n\n    // hand-made alpha-test\n    if (gl_FragColor[3] < uDiscardAlphaLevel) {\n        discard;\n    }\n}\n";
//#endregion
//#region renderer/shaders/webgl/hdNew.fs.glsl?raw
var hdNew_fs_default = "#version 300 es\nprecision mediump float;\n\nin vec2 vTextureCoord;\nin vec3 vNormal;\nin vec3 vTangent;\nin vec3 vBinormal;\nin mat3 vTBN;\nin vec3 vFragPos;\n\nout vec4 FragColor;\n\nuniform sampler2D uSampler;\nuniform sampler2D uNormalSampler;\nuniform sampler2D uOrmSampler;\nuniform vec3 uReplaceableColor;\nuniform float uDiscardAlphaLevel;\nuniform float uLayerAlpha;\nuniform mat3 uTVertexAnim;\nuniform vec3 uLightPos;\nuniform vec3 uLightColor;\nuniform vec3 uCameraPos;\nuniform vec3 uShadowParams;\nuniform sampler2D uShadowMapSampler;\nuniform mat4 uShadowMapLightMatrix;\nuniform bool uHasEnv;\nuniform vec4 uWispLight;\nuniform vec3 uWispKey;\nuniform vec3 uWispAmbient;\nuniform vec4 uWispFog;\nuniform highp vec4 uWispFogRange;\nuniform float uWispFogMax;\nuniform vec3 uWispLayer;\nuniform vec3 uWispGeosetColor;\nuniform int uWispPointCount;\nuniform vec3 uWispPointPos[8];\nuniform vec3 uWispPointColor[8];\nuniform vec2 uWispPointRange[8];\nuniform mat4 uWispModel;\nuniform mat3 uWispNormal;\nuniform highp sampler2D uWispShadowMap;\nuniform highp mat4 uWispShadowMatrix;\nuniform highp vec4 uWispShadow;\nuniform highp sampler2D uWispPointShadowMap;\nuniform highp mat4 uWispPointShadowMatrix[6];\nuniform vec2 uWispPointCaster;\nuniform highp vec3 uWispPointCasterPos[2];\nuniform highp vec4 uWispPointShadow;\n\nfloat wispSun(highp vec3 fragPos) {\n    if (uWispShadow.x < 0.5) return 1.;\n    highp vec4 at = uWispShadowMatrix * vec4(fragPos, 1.);\n    highp vec3 c = at.xyz / at.w * 0.5 + 0.5;\n    if (c.x <= 0. || c.x >= 1. || c.y <= 0. || c.y >= 1. || c.z >= 1.) return 1.;\n    float lit = 0.;\n    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {\n        lit += texture(uWispShadowMap, c.xy + vec2(float(dx), float(dy)) * uWispShadow.z).r >= c.z - uWispShadow.y ? 1. : 0.;\n    }\n    return lit / 9.;\n}\n\nfloat wispPointShadow(float slot, highp vec3 d) {\n    highp vec3 a = abs(d);\n    int face = a.x >= a.y && a.x >= a.z ? (d.x > 0. ? 0 : 1) : a.y >= a.z ? (d.y > 0. ? 2 : 3) : (d.z > 0. ? 4 : 5);\n    highp mat4 m = face == 0 ? uWispPointShadowMatrix[0] : face == 1 ? uWispPointShadowMatrix[1] : face == 2 ? uWispPointShadowMatrix[2] : face == 3 ? uWispPointShadowMatrix[3] : face == 4 ? uWispPointShadowMatrix[4] : uWispPointShadowMatrix[5];\n    highp vec4 at = m * vec4(d, 1.);\n    highp vec3 c = at.xyz / at.w * 0.5 + 0.5;\n    highp float near = uWispPointShadow.x, far = uWispPointShadow.y;\n    highp float own = 2. * near * far / (far + near - (2. * c.z - 1.) * (far - near));\n    if (own >= far) return 1.;\n    vec2 cell = vec2(mod(float(face), 3.), floor(float(face) / 3.) + 2. * slot);\n    float lit = 0.;\n    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {\n        highp vec2 inCell = clamp(c.xy + vec2(float(dx), float(dy)) * uWispPointShadow.z, uWispPointShadow.z, 1. - uWispPointShadow.z);\n        highp float stored = texture(uWispPointShadowMap, (cell + inCell) / vec2(3., 4.)).r;\n        highp float blocker = 2. * near * far / (far + near - (2. * stored - 1.) * (far - near));\n        lit += blocker >= own - (3. + own * 0.02) ? 1. : 0.;\n    }\n    return lit / 9.;\n}\nuniform samplerCube uIrradianceMap;\nuniform samplerCube uPrefilteredEnv;\nuniform sampler2D uBRDFLUT;\nuniform float uWireframe;\n\nconst float PI = 3.14159265359;\nconst float gamma = 2.2;\nconst float MAX_REFLECTION_LOD = ${MAX_ENV_MIP_LEVELS};\n\nfloat distributionGGX(vec3 normal, vec3 halfWay, float roughness) {\n    float a = roughness * roughness;\n    float a2 = a * a;\n    float nDotH = max(dot(normal, halfWay), 0.0);\n    float nDotH2 = nDotH * nDotH;\n\n    float num = a2;\n    float denom = (nDotH2 * (a2 - 1.0) + 1.0);\n    denom = PI * denom * denom;\n\n    return num / denom;\n}\n\nfloat geometrySchlickGGX(float nDotV, float roughness) {\n    float r = roughness + 1.;\n    float k = r * r / 8.;\n    // float k = roughness * roughness / 2.;\n\n    float num = nDotV;\n    float denom = nDotV * (1. - k) + k;\n\n    return num / denom;\n}\n\nfloat geometrySmith(vec3 normal, vec3 viewDir, vec3 lightDir, float roughness) {\n    float nDotV = max(dot(normal, viewDir), .0);\n    float nDotL = max(dot(normal, lightDir), .0);\n    float ggx2  = geometrySchlickGGX(nDotV, roughness);\n    float ggx1  = geometrySchlickGGX(nDotL, roughness);\n\n    return ggx1 * ggx2;\n}\n\nvec3 fresnelSchlick(float lightFactor, vec3 f0) {\n    return f0 + (1. - f0) * pow(clamp(1. - lightFactor, 0., 1.), 5.);\n}\n\nvec3 fresnelSchlickRoughness(float lightFactor, vec3 f0, float roughness) {\n    return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(clamp(1.0 - lightFactor, 0.0, 1.0), 5.0);\n}\n\nvec3 wispPoints(vec3 fragPos, vec3 normal) {\n    vec3 sum = vec3(0.);\n    if (uWispPointCount <= 0) return sum;\n    vec3 world = (uWispModel * vec4(fragPos, 1.)).xyz;\n    vec3 n = normalize(uWispNormal * normal);\n    float shade0 = uWispPointCaster.x < -0.5 ? 1. : wispPointShadow(0., world - uWispPointCasterPos[0]);\n    float shade1 = uWispPointCaster.y < -0.5 ? 1. : wispPointShadow(1., world - uWispPointCasterPos[1]);\n    for (int i = 0; i < 8; i++) {\n        if (i >= uWispPointCount) break;\n        vec3 toward = uWispPointPos[i] - world;\n        float dist = length(toward);\n        float reach = clamp((uWispPointRange[i].y - dist) / max(uWispPointRange[i].y - uWispPointRange[i].x, 1.), 0., 1.);\n        sum += uWispPointColor[i] * reach * max(dot(n, toward / max(dist, 1e-3)), 0.) * (float(i) == uWispPointCaster.x ? shade0 : float(i) == uWispPointCaster.y ? shade1 : 1.);\n    }\n    return sum;\n}\n\nvoid main(void) {\n    if (uWireframe > 0.) {\n        FragColor = vec4(1.);\n        return;\n    }\n\n    vec2 texCoord = (uTVertexAnim * vec3(vTextureCoord.s, vTextureCoord.t, 1.)).st;\n\n    vec4 orm = texture(uOrmSampler, texCoord);\n\n    float occlusion = orm.r;\n    float roughness = orm.g;\n    float metallic = orm.b;\n    float teamColorFactor = orm.a;\n\n    vec4 baseColor = texture(uSampler, texCoord);\n    vec3 teamColor = baseColor.rgb * uReplaceableColor;\n    baseColor.rgb = mix(baseColor.rgb, teamColor, teamColorFactor);\n    baseColor.rgb *= uWispGeosetColor;\n    baseColor.rgb = pow(baseColor.rgb, vec3(gamma));\n\n    vec3 normal = texture(uNormalSampler, texCoord).rgb;\n    normal = normal * 2.0 - 1.0;\n    normal.x = -normal.x;\n    normal.y = -normal.y;\n    if (!gl_FrontFacing) {\n        normal = -normal;\n    }\n    normal = normalize(vTBN * -normal);\n\n    vec3 viewDir = normalize(uCameraPos - vFragPos);\n    vec3 reflected = reflect(-viewDir, normal);\n\n    vec3 lightDir = uWispLight.w > 0.5 ? uWispLight.xyz : normalize(uLightPos - vFragPos);\n    float lightFactor = max(dot(normal, lightDir), .0);\n    vec3 radiance = uWispLight.w > 0.5 ? uWispKey * PI : uLightColor;\n\n    vec3 f0 = vec3(.04);\n    f0 = mix(f0, baseColor.rgb, metallic);\n\n    vec3 totalLight = vec3(0.);\n    vec3 halfWay = normalize(viewDir + lightDir);\n    float ndf = distributionGGX(normal, halfWay, roughness);\n    float g = geometrySmith(normal, viewDir, lightDir, roughness);\n    vec3 f = fresnelSchlick(max(dot(halfWay, viewDir), 0.), f0);\n\n    vec3 kS = f;\n    vec3 kD = vec3(1.);// - kS;\n    if (uHasEnv) {\n        kD *= 1.0 - metallic;\n    }\n    vec3 num = ndf * g * f;\n    float denom = 4. * max(dot(normal, viewDir), 0.) * max(dot(normal, lightDir), 0.) + .0001;\n    vec3 specular = num / denom;\n\n    totalLight = (kD * baseColor.rgb / PI + specular) * radiance * lightFactor * wispSun(vFragPos);\n    totalLight += kD * baseColor.rgb * wispPoints(vFragPos, vTBN[2]);\n\n    if (uShadowParams[0] > .5) {\n        float shadowBias = uShadowParams[1];\n        float shadowStep = uShadowParams[2];\n        vec4 fragInLightPos = uShadowMapLightMatrix * vec4(vFragPos, 1.);\n        vec3 shadowMapCoord = fragInLightPos.xyz / fragInLightPos.w;\n        shadowMapCoord.xyz = (shadowMapCoord.xyz + 1.0) * .5;\n\n        int passes = 5;\n        float step = 1. / float(passes);\n\n        float lightDepth = texture(uShadowMapSampler, shadowMapCoord.xy).r;\n        float lightDepth0 = texture(uShadowMapSampler, vec2(shadowMapCoord.x + shadowStep, shadowMapCoord.y)).r;\n        float lightDepth1 = texture(uShadowMapSampler, vec2(shadowMapCoord.x, shadowMapCoord.y + shadowStep)).r;\n        float lightDepth2 = texture(uShadowMapSampler, vec2(shadowMapCoord.x, shadowMapCoord.y - shadowStep)).r;\n        float lightDepth3 = texture(uShadowMapSampler, vec2(shadowMapCoord.x - shadowStep, shadowMapCoord.y)).r;\n        float currentDepth = shadowMapCoord.z;\n\n        float visibility = 0.;\n        if (lightDepth > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth0 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth1 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth2 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n        if (lightDepth3 > currentDepth - shadowBias) {\n            visibility += step;\n        }\n\n        totalLight *= visibility;\n    }\n\n    vec3 color;\n\n    if (uWispLight.w > 0.5) {\n        color = uWispAmbient * baseColor.rgb * occlusion + totalLight;\n    } else if (uHasEnv) {\n        vec3 f = fresnelSchlickRoughness(max(dot(normal, viewDir), 0.0), f0, roughness);\n        vec3 kS = f;\n        vec3 kD = vec3(1.0) - kS;\n        kD *= 1.0 - metallic;\n\n        vec3 diffuse = texture(uIrradianceMap, normal).rgb * baseColor.rgb;\n        vec3 prefilteredColor = textureLod(uPrefilteredEnv, reflected, roughness * MAX_REFLECTION_LOD).rgb;\n        vec2 envBRDF = texture(uBRDFLUT, vec2(max(dot(normal, viewDir), 0.0), roughness)).rg;\n        specular = prefilteredColor * (f * envBRDF.x + envBRDF.y);\n\n        vec3 ambient = (kD * diffuse + specular) * occlusion;\n        color = ambient + totalLight;\n    } else {\n        vec3 ambient = vec3(.03);\n        ambient *= baseColor.rgb * occlusion;\n        color = ambient + totalLight;\n    }\n\n    if (uWispLight.w < 0.5) color = color / (vec3(1.) + color);\n    color = pow(clamp(color, 0., 1.), vec3(1. / gamma));\n\n    FragColor = vec4(color, baseColor.a * uLayerAlpha);\n    if (uWispFog.w > 0.5 && uWispLayer.y < 0.5) {\n        highp float wispDepth = uWispFogRange.z / max(1. - gl_FragCoord.z * uWispFogRange.w, 1e-6);\n        float wispFog = clamp((wispDepth - uWispFogRange.x) / max(uWispFogRange.y - uWispFogRange.x, 1.), 0., uWispFogMax);\n        FragColor.rgb = mix(FragColor.rgb, uWispLayer.z > 0.5 ? vec3(0.) : uWispFog.rgb, wispFog);\n    }\n\n    // hand-made alpha-test\n    if (FragColor[3] < uDiscardAlphaLevel) {\n        discard;\n    }\n}\n";
//#endregion
//#region renderer/shaders/webgl/skeleton.vs.glsl?raw
var skeleton_vs_default = "attribute vec3 aVertexPosition;\nattribute vec3 aColor;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec3 vColor;\n\nvoid main(void) {\n    vec4 position = vec4(aVertexPosition, 1.0);\n    gl_Position = uPMatrix * uMVMatrix * position;\n    vColor = aColor;\n}";
//#endregion
//#region renderer/shaders/webgl/skeleton.fs.glsl?raw
var skeleton_fs_default = "precision mediump float;\n\nvarying vec3 vColor;\n\nvoid main(void) {\n    gl_FragColor = vec4(vColor, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/envToCubemap.vs.glsl?raw
var envToCubemap_vs_default = "attribute vec3 aPos;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec3 vLocalPos;\n\nvoid main(void) {\n    vLocalPos = aPos;\n    gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/envToCubemap.fs.glsl?raw
var envToCubemap_fs_default = "precision mediump float;\n\nvarying vec3 vLocalPos;\n\nuniform sampler2D uEquirectangularMap;\n\nconst vec2 invAtan = vec2(0.1591, 0.3183);\n\nvec2 SampleSphericalMap(vec3 v) {\n    // vec2 uv = vec2(atan(v.z, v.x), asin(v.y));\n    vec2 uv = vec2(atan(v.x, v.y), asin(-v.z));\n    uv *= invAtan;\n    uv += 0.5;\n    return uv;\n}\n\nvoid main(void) {\n    vec2 uv = SampleSphericalMap(normalize(vLocalPos)); // make sure to normalize localPos\n    vec3 color = texture2D(uEquirectangularMap, uv).rgb;\n\n    gl_FragColor = vec4(color, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/env.vs.glsl?raw
var env_vs_default = "#version 300 es\n\nin vec3 aPos;\nout vec3 vLocalPos;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvoid main(void) {\n    vLocalPos = aPos;\n    mat4 rotView = mat4(mat3(uMVMatrix)); // remove translation from the view matrix\n    vec4 clipPos = uPMatrix * rotView * 1000. * vec4(aPos, 1.0);\n\n    gl_Position = clipPos.xyww;\n}";
//#endregion
//#region renderer/shaders/webgl/env.fs.glsl?raw
var env_fs_default = "#version 300 es\nprecision mediump float;\n\nin vec3 vLocalPos;\n\nout vec4 FragColor;\n\nuniform samplerCube uEnvironmentMap;\n\nvoid main(void) {\n    // vec3 envColor = textureLod(uEnvironmentMap, vLocalPos, 0.0).rgb;\n    vec3 envColor = texture(uEnvironmentMap, vLocalPos).rgb;\n\n    FragColor = vec4(envColor, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/convoluteEnvDiffuse.vs.glsl?raw
var convoluteEnvDiffuse_vs_default = "attribute vec3 aPos;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvarying vec3 vLocalPos;\n\nvoid main(void) {\n    vLocalPos = aPos;\n    gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/convoluteEnvDiffuse.fs.glsl?raw
var convoluteEnvDiffuse_fs_default = "precision mediump float;\n\nvarying vec3 vLocalPos;\n\nuniform samplerCube uEnvironmentMap;\n\nconst float PI = 3.14159265359;\nconst float gamma = 2.2;\n\nvoid main(void) {\n    vec3 irradiance = vec3(0.0);\n\n    // the sample direction equals the hemisphere's orientation\n    vec3 normal = normalize(vLocalPos);\n\n    vec3 up    = vec3(0.0, 1.0, 0.0);\n    vec3 right = normalize(cross(up, normal));\n    up         = normalize(cross(normal, right));\n\n    const float sampleDelta = 0.025;\n    float nrSamples = 0.0;\n    for(float phi = 0.0; phi < 2.0 * PI; phi += sampleDelta)\n    {\n        for(float theta = 0.0; theta < 0.5 * PI; theta += sampleDelta)\n        {\n            // spherical to cartesian (in tangent space)\n            vec3 tangentSample = vec3(sin(theta) * cos(phi),  sin(theta) * sin(phi), cos(theta));\n            // tangent space to world\n            vec3 sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal;\n\n            irradiance += pow(textureCube(uEnvironmentMap, sampleVec).rgb, vec3(gamma)) * cos(theta) * sin(theta);\n            nrSamples++;\n        }\n    }\n    irradiance = PI * irradiance * (1.0 / float(nrSamples));\n\n    gl_FragColor = vec4(irradiance, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/prefilterEnv.vs.glsl?raw
var prefilterEnv_vs_default = "#version 300 es\n\nin vec3 aPos;\n\nout vec3 vLocalPos;\n\nuniform mat4 uMVMatrix;\nuniform mat4 uPMatrix;\n\nvoid main(void) {\n    vLocalPos = aPos;\n    gl_Position = uPMatrix * uMVMatrix * vec4(aPos, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/prefilterEnv.fs.glsl?raw
var prefilterEnv_fs_default = "#version 300 es\nprecision mediump float;\nprecision highp int;\n\nout vec4 FragColor;\n\nin vec3 vLocalPos;\n\nuniform samplerCube uEnvironmentMap;\nuniform float uRoughness;\n\nconst float PI = 3.14159265359;\nconst float gamma = 2.2;\n\nfloat RadicalInverse_VdC(uint bits) {\n    bits = (bits << 16u) | (bits >> 16u);\n    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);\n    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);\n    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);\n    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);\n    return float(bits) * 2.3283064365386963e-10; // / 0x100000000\n}\n\nvec2 Hammersley(uint i, uint N) {\n    return vec2(float(i)/float(N), RadicalInverse_VdC(i));\n}\n\nvec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float roughness) {\n    float a = roughness * roughness;\n\n    float phi = 2.0 * PI * Xi.x;\n    float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));\n    float sinTheta = sqrt(1.0 - cosTheta*cosTheta);\n\n    // from spherical coordinates to cartesian coordinates\n    vec3 H;\n    H.x = cos(phi) * sinTheta;\n    H.y = sin(phi) * sinTheta;\n    H.z = cosTheta;\n\n    // from tangent-space vector to world-space sample vector\n    vec3 up        = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);\n    vec3 tangent   = normalize(cross(up, N));\n    vec3 bitangent = cross(N, tangent);\n\n    vec3 sampleVec = tangent * H.x + bitangent * H.y + N * H.z;\n\n    return normalize(sampleVec);\n}\n\nvoid main() {\n    vec3 N = normalize(vLocalPos);\n    vec3 R = N;\n    vec3 V = R;\n\n    const uint SAMPLE_COUNT = 1024u;\n    float totalWeight = 0.0;\n    vec3 prefilteredColor = vec3(0.0);\n    for(uint i = 0u; i < SAMPLE_COUNT; ++i)\n    {\n        vec2 Xi = Hammersley(i, SAMPLE_COUNT);\n        vec3 H  = ImportanceSampleGGX(Xi, N, uRoughness);\n        vec3 L  = normalize(2.0 * dot(V, H) * H - V);\n\n        float NdotL = max(dot(N, L), 0.0);\n        if(NdotL > 0.0) {\n            prefilteredColor += pow(texture(uEnvironmentMap, L).rgb, vec3(gamma)) * NdotL;\n            totalWeight      += NdotL;\n        }\n    }\n    prefilteredColor = prefilteredColor / totalWeight;\n\n    FragColor = vec4(prefilteredColor, 1.0);\n}\n";
//#endregion
//#region renderer/shaders/webgl/integrateBRDF.vs.glsl?raw
var integrateBRDF_vs_default = "#version 300 es\n\nin vec3 aPos;\n\nout vec2 vLocalPos;\n\nvoid main(void) {\n    vLocalPos = aPos.xy;\n    gl_Position = vec4(aPos, 1.0);\n}";
//#endregion
//#region renderer/shaders/webgl/integrateBRDF.fs.glsl?raw
var integrateBRDF_fs_default = "#version 300 es\nprecision mediump float;\n\nin vec2 vLocalPos;\n\nout vec4 FragColor;\n\nconst float PI = 3.14159265359;\n\nfloat RadicalInverse_VdC(uint bits) {\n    bits = (bits << 16u) | (bits >> 16u);\n    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);\n    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);\n    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);\n    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);\n    return float(bits) * 2.3283064365386963e-10; // / 0x100000000\n}\n\nvec2 Hammersley(uint i, uint N) {\n    return vec2(float(i)/float(N), RadicalInverse_VdC(i));\n}\n\nvec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float roughness) {\n    float a = roughness * roughness;\n\n    float phi = 2.0 * PI * Xi.x;\n    float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));\n    float sinTheta = sqrt(1.0 - cosTheta*cosTheta);\n\n    // from spherical coordinates to cartesian coordinates\n    vec3 H;\n    H.x = cos(phi) * sinTheta;\n    H.y = sin(phi) * sinTheta;\n    H.z = cosTheta;\n\n    // from tangent-space vector to world-space sample vector\n    vec3 up        = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);\n    vec3 tangent   = normalize(cross(up, N));\n    vec3 bitangent = cross(N, tangent);\n\n    vec3 sampleVec = tangent * H.x + bitangent * H.y + N * H.z;\n\n    return normalize(sampleVec);\n}\n\nfloat geometrySchlickGGX(float nDotV, float roughness) {\n    float r = roughness;\n    float k = r * r / 2.;\n\n    float num = nDotV;\n    float denom = nDotV * (1. - k) + k;\n\n    return num / denom;\n}\n\nfloat geometrySmith(vec3 normal, vec3 viewDir, vec3 lightDir, float roughness) {\n    float nDotV = max(dot(normal, viewDir), .0);\n    float nDotL = max(dot(normal, lightDir), .0);\n    float ggx2  = geometrySchlickGGX(nDotV, roughness);\n    float ggx1  = geometrySchlickGGX(nDotL, roughness);\n\n    return ggx1 * ggx2;\n}\n\nvec2 IntegrateBRDF(float NdotV, float roughness) {\n    vec3 V;\n    V.x = sqrt(1.0 - NdotV*NdotV);\n    V.y = 0.0;\n    V.z = NdotV;\n\n    float A = 0.0;\n    float B = 0.0;\n\n    vec3 N = vec3(0.0, 0.0, 1.0);\n\n    const uint SAMPLE_COUNT = 1024u;\n    for(uint i = 0u; i < SAMPLE_COUNT; ++i)\n    {\n        vec2 Xi = Hammersley(i, SAMPLE_COUNT);\n        vec3 H  = ImportanceSampleGGX(Xi, N, roughness);\n        vec3 L  = normalize(2.0 * dot(V, H) * H - V);\n\n        float NdotL = max(L.z, 0.0);\n        float NdotH = max(H.z, 0.0);\n        float VdotH = max(dot(V, H), 0.0);\n\n        if(NdotL > 0.0)\n        {\n            float G = geometrySmith(N, V, L, roughness);\n            float G_Vis = (G * VdotH) / (NdotH * NdotV);\n            float Fc = pow(1.0 - VdotH, 5.0);\n\n            A += (1.0 - Fc) * G_Vis;\n            B += Fc * G_Vis;\n        }\n    }\n    A /= float(SAMPLE_COUNT);\n    B /= float(SAMPLE_COUNT);\n    return vec2(A, B);\n}\n\nvoid main() {\n    FragColor = vec4(IntegrateBRDF((vLocalPos.x + 1.0) * .5, (vLocalPos.y + 1.0) * .5), 0., 1.);\n}";
//#endregion
//#region renderer/shaders/webgpu/sd.wgsl?raw
var sd_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n    nodesMatrices: array<mat4x4f, ${MAX_NODES}>,\n}\n\nstruct FSUniforms {\n    replaceableColor: vec3f,\n    replaceableType: u32,\n    discardAlphaLevel: f32,\n    wireframe: u32,\n    tVertexAnim: mat3x3f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformSampler: sampler;\n@group(1) @binding(2) var fsUniformTexture: texture_2d<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) normal: vec3f,\n    @location(2) textureCoord: vec2f,\n    @location(3) group: vec4<u32>,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) normal: vec3f,\n    @location(1) textureCoord: vec2f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n    var count: i32 = 1;\n    var sum: vec4f = vsUniforms.nodesMatrices[in.group[0]] * position;\n\n    if (in.group[1] < ${MAX_NODES}) {\n        sum += vsUniforms.nodesMatrices[in.group[1]] * position;\n        count += 1;\n    }\n    if (in.group[2] < ${MAX_NODES}) {\n        sum += vsUniforms.nodesMatrices[in.group[2]] * position;\n        count += 1;\n    }\n    if (in.group[3] < ${MAX_NODES}) {\n        sum += vsUniforms.nodesMatrices[in.group[3]] * position;\n        count += 1;\n    }\n    sum /= f32(count);\n    sum.w = 1.;\n    position = sum;\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.textureCoord = in.textureCoord;\n    out.normal = in.normal;\n    return out;\n}\n\nfn hypot(z: vec2f) -> f32 {\n    var t: f32 = 0;\n    var x: f32 = abs(z.x);\n    let y: f32 = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    if (z.x == 0.0 && z.y == 0.0) {\n        return 0.0;\n    }\n    return x * sqrt(1.0 + t * t);\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    if (fsUniforms.wireframe > 0) {\n        return vec4f(1);\n    }\n\n    let texCoord: vec2f = (fsUniforms.tVertexAnim * vec3f(in.textureCoord.x, in.textureCoord.y, 1.)).xy;\n    var color: vec4f = vec4f(0.0);\n\n    if (fsUniforms.replaceableType == 0) {\n        color = textureSample(fsUniformTexture, fsUniformSampler, texCoord);\n    } else if (fsUniforms.replaceableType == 1) {\n        color = vec4f(fsUniforms.replaceableColor, 1.0);\n    } else if (fsUniforms.replaceableType == 2) {\n        let dist: f32 = hypot(texCoord - vec2(0.5, 0.5)) * 2.;\n        let truncateDist: f32 = clamp(1. - dist * 1.4, 0., 1.);\n        let alpha: f32 = sin(truncateDist);\n        color = vec4f(fsUniforms.replaceableColor * alpha, 1.0);\n    }\n\n    // hand-made alpha-test\n    if (color.a < fsUniforms.discardAlphaLevel) {\n        discard;\n    }\n\n    return color;\n}\n";
//#endregion
//#region renderer/shaders/webgpu/hd.wgsl?raw
var hd_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n    nodesMatrices: array<mat4x4f, ${MAX_NODES}>,\n}\n\nstruct FSUniforms {\n    replaceableColor: vec3f,\n    // replaceableType: u32,\n    discardAlphaLevel: f32,\n    tVertexAnim: mat3x3f,\n    lightPos: vec3f,\n    hasEnv: u32,\n    lightColor: vec3f,\n    wireframe: u32,\n    cameraPos: vec3f,\n    shadowParams: vec3f,\n    shadowMapLightMatrix: mat4x4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformDiffuseSampler: sampler;\n@group(1) @binding(2) var fsUniformDiffuseTexture: texture_2d<f32>;\n@group(1) @binding(3) var fsUniformNormalSampler: sampler;\n@group(1) @binding(4) var fsUniformNormalTexture: texture_2d<f32>;\n@group(1) @binding(5) var fsUniformOrmSampler: sampler;\n@group(1) @binding(6) var fsUniformOrmTexture: texture_2d<f32>;\n@group(1) @binding(7) var fsUniformShadowSampler: sampler_comparison;\n@group(1) @binding(8) var fsUniformShadowTexture: texture_depth_2d;\n@group(1) @binding(9) var irradienceMapSampler: sampler;\n@group(1) @binding(10) var irradienceMapTexture: texture_cube<f32>;\n@group(1) @binding(11) var prefilteredEnvSampler: sampler;\n@group(1) @binding(12) var prefilteredEnvTexture: texture_cube<f32>;\n@group(1) @binding(13) var brdfLutSampler: sampler;\n@group(1) @binding(14) var brdfLutTexture: texture_2d<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) normal: vec3f,\n    @location(2) textureCoord: vec2f,\n    @location(3) tangent: vec4f,\n    @location(4) skin: vec4<u32>,\n    @location(5) boneWeight: vec4f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) normal: vec3f,\n    @location(1) textureCoord: vec2f,\n    @location(2) tangent: vec3f,\n    @location(3) binormal: vec3f,\n    @location(4) fragPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n    var sum: mat4x4f;\n\n    sum += vsUniforms.nodesMatrices[in.skin[0]] * in.boneWeight[0];\n    sum += vsUniforms.nodesMatrices[in.skin[1]] * in.boneWeight[1];\n    sum += vsUniforms.nodesMatrices[in.skin[2]] * in.boneWeight[2];\n    sum += vsUniforms.nodesMatrices[in.skin[3]] * in.boneWeight[3];\n\n    let rotation: mat3x3f = mat3x3f(sum[0].xyz, sum[1].xyz, sum[2].xyz);\n\n    position = sum * position;\n    position.w = 1;\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.textureCoord = in.textureCoord;\n    out.normal = in.normal;\n\n    var normal: vec3f = in.normal;\n    var tangent: vec3f = in.tangent.xyz;\n\n    // https://learnopengl.com/Advanced-Lighting/Normal-Mapping\n    tangent = normalize(tangent - dot(tangent, normal) * normal);\n\n    var binormal: vec3f = cross(normal, tangent) * in.tangent.w;\n\n    normal = normalize(rotation * normal);\n    tangent = normalize(rotation * tangent);\n    binormal = normalize(rotation * binormal);\n\n    out.normal = normal;\n    out.tangent = tangent;\n    out.binormal = binormal;\n\n    out.fragPos = position.xyz;\n\n    return out;\n}\n\nfn hypot(z: vec2f) -> f32 {\n    var t: f32 = 0;\n    var x: f32 = abs(z.x);\n    let y: f32 = abs(z.y);\n    t = min(x, y);\n    x = max(x, y);\n    t = t / x;\n    if (z.x == 0.0 && z.y == 0.0) {\n        return 0.0;\n    }\n    return x * sqrt(1.0 + t * t);\n}\n\nconst PI: f32 = 3.14159265359;\nconst gamma: f32 = 2.2;\nconst MAX_REFLECTION_LOD: f32 = ${MAX_ENV_MIP_LEVELS};\n\nfn distributionGGX(normal: vec3f, halfWay: vec3f, roughness: f32) -> f32 {\n    let a: f32 = roughness * roughness;\n    let a2: f32 = a * a;\n    let nDotH: f32 = max(dot(normal, halfWay), 0.0);\n    let nDotH2: f32 = nDotH * nDotH;\n\n    let num: f32 = a2;\n    var denom: f32 = (nDotH2 * (a2 - 1.0) + 1.0);\n    denom = PI * denom * denom;\n\n    return num / denom;\n}\n\nfn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {\n    let r: f32 = roughness + 1.;\n    let k: f32 = r * r / 8.;\n    // float k = roughness * roughness / 2.;\n\n    let num: f32 = nDotV;\n    let denom: f32 = nDotV * (1. - k) + k;\n\n    return num / denom;\n}\n\nfn geometrySmith(normal: vec3f, viewDir: vec3f, lightDir: vec3f, roughness: f32) -> f32 {\n    let nDotV: f32 = max(dot(normal, viewDir), .0);\n    let nDotL: f32 = max(dot(normal, lightDir), .0);\n    let ggx2: f32  = geometrySchlickGGX(nDotV, roughness);\n    let ggx1: f32  = geometrySchlickGGX(nDotL, roughness);\n\n    return ggx1 * ggx2;\n}\n\nfn fresnelSchlick(lightFactor: f32, f0: vec3f) -> vec3f {\n    return f0 + (1. - f0) * pow(clamp(1. - lightFactor, 0., 1.), 5.);\n}\n\nfn fresnelSchlickRoughness(lightFactor: f32, f0: vec3f, roughness: f32) -> vec3f {\n    return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(clamp(1.0 - lightFactor, 0.0, 1.0), 5.0);\n}\n\n@fragment fn fs(\n    in: VSOut,\n    @builtin(front_facing) isFront: bool\n) -> @location(0) vec4f {\n    if (fsUniforms.wireframe > 0) {\n        return vec4f(1);\n    }\n\n    let texCoord: vec2f = (fsUniforms.tVertexAnim * vec3f(in.textureCoord.x, in.textureCoord.y, 1.)).xy;\n    var baseColor: vec4f = textureSample(fsUniformDiffuseTexture, fsUniformDiffuseSampler, texCoord);\n\n    // hand-made alpha-test\n    if (baseColor.a < fsUniforms.discardAlphaLevel) {\n        discard;\n    }\n\n    let orm: vec4f = textureSample(fsUniformOrmTexture, fsUniformOrmSampler, texCoord);\n\n    let occlusion: f32 = orm.r;\n    let roughness: f32 = orm.g;\n    let metallic: f32 = orm.b;\n    let teamColorFactor: f32 = orm.a;\n\n    var teamColor: vec3f = baseColor.rgb * fsUniforms.replaceableColor;\n    baseColor = vec4(mix(baseColor.rgb, teamColor, teamColorFactor), baseColor.a);\n    baseColor = vec4(pow(baseColor.rgb, vec3f(gamma)), baseColor.a);\n\n    let TBN: mat3x3f = mat3x3f(in.tangent, in.binormal, in.normal);\n\n    var normal: vec3f = textureSample(fsUniformNormalTexture, fsUniformNormalSampler, texCoord).xyz;\n    normal = normal * 2 - 1;\n    normal.x = -normal.x;\n    normal.y = -normal.y;\n    if (!isFront) {\n        normal = -normal;\n    }\n    normal = normalize(TBN * -normal);\n\n    let viewDir: vec3f = normalize(fsUniforms.cameraPos - in.fragPos);\n    let reflected = reflect(-viewDir, normal);\n\n    let lightDir: vec3f = normalize(fsUniforms.lightPos - in.fragPos);\n    let lightFactor: f32 = max(dot(normal, lightDir), 0);\n    let radiance: vec3f = fsUniforms.lightColor;\n\n    var f0 = vec3f(.04);\n    f0 = mix(f0, baseColor.rgb, metallic);\n\n    var totalLight: vec3f = vec3f(0);\n    let halfWay: vec3f = normalize(viewDir + lightDir);\n    let ndf: f32 = distributionGGX(normal, halfWay, roughness);\n    let g: f32 = geometrySmith(normal, viewDir, lightDir, roughness);\n    let f: vec3f = fresnelSchlick(max(dot(halfWay, viewDir), 0), f0);\n\n    let kS = f;\n    var kD = vec3f(1);// - kS;\n    if (fsUniforms.hasEnv > 0) {\n        kD *= 1 - metallic;\n    }\n    let num: vec3f = ndf * g * f;\n    let denom: f32 = 4. * max(dot(normal, viewDir), 0.) * max(dot(normal, lightDir), 0.) + .0001;\n    var specular: vec3f = num / denom;\n\n    totalLight = (kD * baseColor.rgb / PI + specular) * radiance * lightFactor;\n\n    if (fsUniforms.shadowParams[0] > .5) {\n        let shadowBias: f32 = fsUniforms.shadowParams[1];\n        let shadowStep: f32 = fsUniforms.shadowParams[2];\n        let fragInLightPos: vec4f = fsUniforms.shadowMapLightMatrix * vec4f(in.fragPos, 1.);\n        var shadowMapCoord: vec3f = fragInLightPos.xyz / fragInLightPos.w;\n        shadowMapCoord = vec3f((shadowMapCoord.xy + 1) * .5, shadowMapCoord.z);\n        shadowMapCoord.y = 1 - shadowMapCoord.y;\n\n        let passes: u32 = 5;\n        let step: f32 = 1. / f32(passes);\n\n        let currentDepth: f32 = shadowMapCoord.z;\n        var lightDepth: f32 = textureSampleCompare(fsUniformShadowTexture, fsUniformShadowSampler, shadowMapCoord.xy, currentDepth - shadowBias);\n        let lightDepth0: f32 = textureSampleCompare(fsUniformShadowTexture, fsUniformShadowSampler, vec2f(shadowMapCoord.x + shadowStep, shadowMapCoord.y), currentDepth - shadowBias);\n        let lightDepth1: f32 = textureSampleCompare(fsUniformShadowTexture, fsUniformShadowSampler, vec2f(shadowMapCoord.x, shadowMapCoord.y + shadowStep), currentDepth - shadowBias);\n        let lightDepth2: f32 = textureSampleCompare(fsUniformShadowTexture, fsUniformShadowSampler, vec2f(shadowMapCoord.x, shadowMapCoord.y - shadowStep), currentDepth - shadowBias);\n        let lightDepth3: f32 = textureSampleCompare(fsUniformShadowTexture, fsUniformShadowSampler, vec2f(shadowMapCoord.x - shadowStep, shadowMapCoord.y), currentDepth - shadowBias);\n\n        var visibility: f32 = 0.;\n        if (lightDepth > .5) {\n            visibility += step;\n        }\n        if (lightDepth0 > .5) {\n            visibility += step;\n        }\n        if (lightDepth1 > .5) {\n            visibility += step;\n        }\n        if (lightDepth2 > .5) {\n            visibility += step;\n        }\n        if (lightDepth3 > .5) {\n            visibility += step;\n        }\n\n        totalLight *= visibility;\n    }\n\n    var color: vec3f = vec3f(0.0);\n\n    if (fsUniforms.hasEnv > 0) {\n        let f: vec3f = fresnelSchlickRoughness(max(dot(normal, viewDir), 0.0), f0, roughness);\n        let kS: vec3f = f;\n        var kD: vec3f = vec3f(1.0) - kS;\n        kD *= 1.0 - metallic;\n\n        let diffuse: vec3f = textureSample(irradienceMapTexture, irradienceMapSampler, normal).rgb * baseColor.rgb;\n        let prefilteredColor: vec3f = textureSampleLevel(prefilteredEnvTexture, prefilteredEnvSampler, reflected, roughness * MAX_REFLECTION_LOD).rgb;\n        let envBRDF: vec2f = textureSample(brdfLutTexture, brdfLutSampler, vec2f(max(dot(normal, viewDir), 0.0), roughness)).rg;\n        specular = prefilteredColor * (f * envBRDF.x + envBRDF.y);\n\n        let ambient: vec3f = (kD * diffuse + specular) * occlusion;\n        color = ambient + totalLight;\n    } else {\n        var ambient: vec3f = vec3(.03);\n        ambient *= baseColor.rgb * occlusion;\n        color = ambient + totalLight;\n    }\n\n    color = color / (vec3f(1) + color);\n    color = pow(color, vec3f(1 / gamma));\n\n    return vec4f(color, baseColor.a);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/depth.wgsl?raw
var depth_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n    nodesMatrices: array<mat4x4f, ${MAX_NODES}>,\n}\n\nstruct FSUniforms {\n    replaceableColor: vec3f,\n    // replaceableType: u32,\n    discardAlphaLevel: f32,\n    tVertexAnim: mat3x3f,\n    lightPos: vec3f,\n    lightColor: vec3f,\n    cameraPos: vec3f,\n    shadowParams: vec3f,\n    shadowMapLightMatrix: mat4x4f,\n    // env\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformDiffuseSampler: sampler;\n@group(1) @binding(2) var fsUniformDiffuseTexture: texture_2d<f32>;\n@group(1) @binding(3) var fsUniformNormalSampler: sampler;\n@group(1) @binding(4) var fsUniformNormalTexture: texture_2d<f32>;\n@group(1) @binding(5) var fsUniformOrmSampler: sampler;\n@group(1) @binding(6) var fsUniformOrmTexture: texture_2d<f32>;\n@group(1) @binding(7) var fsUniformShadowSampler: sampler_comparison;\n// @group(1) @binding(7) var fsUniformShadowSampler: sampler;\n@group(1) @binding(8) var fsUniformShadowTexture: texture_depth_2d;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) normal: vec3f,\n    @location(2) textureCoord: vec2f,\n    @location(3) tangent: vec4f,\n    @location(4) skin: vec4<u32>,\n    @location(5) boneWeight: vec4f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) textureCoord: vec2f,\n    @location(1) depth: f32,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n    var sum: mat4x4f;\n\n    sum += vsUniforms.nodesMatrices[in.skin[0]] * in.boneWeight[0];\n    sum += vsUniforms.nodesMatrices[in.skin[1]] * in.boneWeight[1];\n    sum += vsUniforms.nodesMatrices[in.skin[2]] * in.boneWeight[2];\n    sum += vsUniforms.nodesMatrices[in.skin[3]] * in.boneWeight[3];\n\n    position = sum * position;\n    position.w = 1;\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.textureCoord = in.textureCoord;\n\n    out.depth = out.position.z / out.position.w;\n\n    return out;\n}\n\nstruct FSOut {\n    @builtin(frag_depth) depth: f32,\n    @location(0) color: vec4f\n}\n\n@fragment fn fs(\n    in: VSOut,\n    @builtin(front_facing) isFront: bool\n) -> FSOut {\n    let texCoord: vec2f = (fsUniforms.tVertexAnim * vec3f(in.textureCoord.x, in.textureCoord.y, 1.)).xy;\n    var baseColor: vec4f = textureSample(fsUniformDiffuseTexture, fsUniformDiffuseSampler, texCoord);\n\n    // hand-made alpha-test\n    if (baseColor.a < fsUniforms.discardAlphaLevel) {\n        discard;\n    }\n\n    var out: FSOut;\n    out.color = vec4f(1, 1, 1, 1);\n    out.depth = in.depth;\n    return out;\n}\n";
//#endregion
//#region renderer/shaders/webgpu/skeleton.wgsl?raw
var skeleton_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n    @location(1) color: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) color: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var position: vec4f = vec4f(in.vertexPosition, 1.0);\n\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;\n    out.color = in.color;\n    return out;\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    return vec4f(in.color, 1);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/env.wgsl?raw
var env_default = "struct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var fsUniformSampler: sampler;\n@group(1) @binding(1) var fsUniformTexture: texture_cube<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) localPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    let rotView: mat4x4f = mat4x4f(\n        vec4f(vsUniforms.mvMatrix[0].xyz, 0),\n        vec4f(vsUniforms.mvMatrix[1].xyz, 0),\n        vec4f(vsUniforms.mvMatrix[2].xyz, 0),\n        vec4f(0, 0, 0, 1)\n    );\n\n    let clipPos: vec4f = vsUniforms.pMatrix * rotView * 1000. * vec4f(in.vertexPosition, 1.0);\n\n    var out: VSOut;\n    out.position = clipPos;\n    out.localPos = in.vertexPosition;\n    return out;\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    return textureSample(fsUniformTexture, fsUniformSampler, in.localPos);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/envToCubemap.wgsl?raw
var envToCubemap_default = "const invAtan: vec2f = vec2f(0.1591, 0.3183);\n\nstruct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var fsUniformSampler: sampler;\n@group(1) @binding(1) var fsUniformTexture: texture_2d<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) localPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * vec4f(in.vertexPosition, 1);\n    out.localPos = in.vertexPosition;\n    return out;\n}\n\nfn SampleSphericalMap(v: vec3f) -> vec2f {\n    // vec2 uv = vec2(atan(v.z, v.x), asin(v.y));\n    var uv: vec2f = vec2f(atan2(v.x, v.y), asin(-v.z));\n    uv *= invAtan;\n    uv += 0.5;\n    return uv;\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    let uv: vec2f = SampleSphericalMap(normalize(in.localPos)); // make sure to normalize localPos\n    let color: vec3f = textureSample(fsUniformTexture, fsUniformSampler, uv).rgb;\n\n    return vec4f(color, 1.0);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/convoluteEnvDiffuse.wgsl?raw
var convoluteEnvDiffuse_default = "const PI: f32 = 3.14159265359;\nconst gamma: f32 = 2.2;\nconst sampleDelta: f32 = 0.025;\n\nstruct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var fsUniformSampler: sampler;\n@group(1) @binding(1) var fsUniformTexture: texture_cube<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) localPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * vec4f(in.vertexPosition, 1);\n    out.localPos = in.vertexPosition;\n    return out;\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    var irradiance: vec3f = vec3f(0);\n\n    // the sample direction equals the hemisphere's orientation\n    let normal: vec3f = normalize(in.localPos);\n\n    var up: vec3f = vec3f(0.0, 1.0, 0.0);\n    let right: vec3f = normalize(cross(up, normal));\n    up = normalize(cross(normal, right));\n\n    var nrSamples: i32 = 0;\n    for (var phi: f32 = 0.0; phi < 2.0 * PI; phi += sampleDelta)\n    {\n        for (var theta: f32 = 0.0; theta < 0.5 * PI; theta += sampleDelta)\n        {\n            // spherical to cartesian (in tangent space)\n            let tangentSample: vec3f = vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));\n            // tangent space to world\n            let sampleVec: vec3f = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal;\n\n            irradiance += pow(textureSample(fsUniformTexture, fsUniformSampler, sampleVec).rgb, vec3f(gamma)) * cos(theta) * sin(theta);\n            nrSamples++;\n        }\n    }\n    irradiance = PI * irradiance * (1.0 / f32(nrSamples));\n\n    return vec4f(irradiance, 1.0);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/prefilterEnv.wgsl?raw
var prefilterEnv_default = "const PI: f32 = 3.14159265359;\nconst gamma: f32 = 2.2;\n\nstruct VSUniforms {\n    mvMatrix: mat4x4f,\n    pMatrix: mat4x4f,\n}\n\nstruct FSUniforms {\n    roughness: f32,\n}\n\n@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;\n@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;\n@group(1) @binding(1) var fsUniformSampler: sampler;\n@group(1) @binding(2) var fsUniformTexture: texture_cube<f32>;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) localPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var out: VSOut;\n    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * vec4f(in.vertexPosition, 1);\n    out.localPos = in.vertexPosition;\n    return out;\n}\n\nfn RadicalInverse_VdC(bits: u32) -> f32 {\n    var res: u32 = bits;\n    res = (res << 16u) | (res >> 16u);\n    res = ((res & 0x55555555u) << 1u) | ((res & 0xAAAAAAAAu) >> 1u);\n    res = ((res & 0x33333333u) << 2u) | ((res & 0xCCCCCCCCu) >> 2u);\n    res = ((res & 0x0F0F0F0Fu) << 4u) | ((res & 0xF0F0F0F0u) >> 4u);\n    res = ((res & 0x00FF00FFu) << 8u) | ((res & 0xFF00FF00u) >> 8u);\n    return f32(res) * 2.3283064365386963e-10; // / 0x100000000\n}\n\nfn Hammersley(i: u32, N: u32) -> vec2f {\n    return vec2f(f32(i)/f32(N), RadicalInverse_VdC(i));\n}\n\nfn ImportanceSampleGGX(Xi: vec2f, N: vec3f, roughness: f32) -> vec3f {\n    let a: f32 = roughness * roughness;\n\n    let phi: f32 = 2.0 * PI * Xi.x;\n    let cosTheta: f32 = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));\n    let sinTheta: f32 = sqrt(1.0 - cosTheta*cosTheta);\n\n    // from spherical coordinates to cartesian coordinates\n    var H: vec3f;\n    H.x = cos(phi) * sinTheta;\n    H.y = sin(phi) * sinTheta;\n    H.z = cosTheta;\n\n    // from tangent-space vector to world-space sample vector\n    var up: vec3f;\n    if (abs(N.z) < 0.999) {\n        up = vec3f(0.0, 0.0, 1.0);\n    } else {\n        up = vec3f(1.0, 0.0, 0.0);\n    }\n    let tangent: vec3f   = normalize(cross(up, N));\n    let bitangent: vec3f = cross(N, tangent);\n\n    let sampleVec: vec3f = tangent * H.x + bitangent * H.y + N * H.z;\n\n    return normalize(sampleVec);\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    let N: vec3f = normalize(in.localPos);\n    let R: vec3f = N;\n    let V: vec3f = R;\n\n    const SAMPLE_COUNT: u32 = 1024u;\n    var totalWeight: f32 = 0.0;\n    var prefilteredColor: vec3f = vec3f(0.0);\n    for(var i: u32 = 0u; i < SAMPLE_COUNT; i++)\n    {\n        let Xi: vec2f = Hammersley(i, SAMPLE_COUNT);\n        let H: vec3f  = ImportanceSampleGGX(Xi, N, fsUniforms.roughness);\n        let L: vec3f  = normalize(2.0 * dot(V, H) * H - V);\n\n        let NdotL: f32 = max(dot(N, L), 0.0);\n        if(NdotL > 0.0) {\n            prefilteredColor += pow(textureSampleLevel(fsUniformTexture, fsUniformSampler, L, 0).rgb, vec3f(gamma)) * NdotL;\n            totalWeight      += NdotL;\n        }\n    }\n    prefilteredColor = prefilteredColor / totalWeight;\n\n    return vec4f(prefilteredColor, 1.0);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/integrateBRDF.wgsl?raw
var integrateBRDF_default = "const PI: f32 = 3.14159265359;\n\nstruct VSIn {\n    @location(0) vertexPosition: vec3f,\n}\n\nstruct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) localPos: vec3f,\n}\n\n@vertex fn vs(\n    in: VSIn\n) -> VSOut {\n    var out: VSOut;\n    out.position = vec4f(in.vertexPosition, 1);\n    out.localPos = in.vertexPosition;\n    return out;\n}\n\nfn RadicalInverse_VdC(bits: u32) -> f32 {\n    var res: u32 = bits;\n    res = (res << 16u) | (res >> 16u);\n    res = ((res & 0x55555555u) << 1u) | ((res & 0xAAAAAAAAu) >> 1u);\n    res = ((res & 0x33333333u) << 2u) | ((res & 0xCCCCCCCCu) >> 2u);\n    res = ((res & 0x0F0F0F0Fu) << 4u) | ((res & 0xF0F0F0F0u) >> 4u);\n    res = ((res & 0x00FF00FFu) << 8u) | ((res & 0xFF00FF00u) >> 8u);\n    return f32(res) * 2.3283064365386963e-10; // / 0x100000000\n}\n\nfn Hammersley(i: u32, N: u32) -> vec2f {\n    return vec2f(f32(i)/f32(N), RadicalInverse_VdC(i));\n}\n\nfn ImportanceSampleGGX(Xi: vec2f, N: vec3f, roughness: f32) -> vec3f {\n    let a: f32 = roughness * roughness;\n\n    let phi: f32 = 2.0 * PI * Xi.x;\n    let cosTheta: f32 = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));\n    let sinTheta: f32 = sqrt(1.0 - cosTheta*cosTheta);\n\n    // from spherical coordinates to cartesian coordinates\n    var H: vec3f;\n    H.x = cos(phi) * sinTheta;\n    H.y = sin(phi) * sinTheta;\n    H.z = cosTheta;\n\n    // from tangent-space vector to world-space sample vector\n    var up: vec3f;\n    if (abs(N.z) < 0.999) {\n        up = vec3f(0.0, 0.0, 1.0);\n    } else {\n        up = vec3f(1.0, 0.0, 0.0);\n    }\n    let tangent: vec3f   = normalize(cross(up, N));\n    let bitangent: vec3f = cross(N, tangent);\n\n    let sampleVec: vec3f = tangent * H.x + bitangent * H.y + N * H.z;\n\n    return normalize(sampleVec);\n}\n\nfn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {\n    let r: f32 = roughness + 1.;\n    let k: f32 = r * r / 8.;\n    // float k = roughness * roughness / 2.;\n\n    let num: f32 = nDotV;\n    let denom: f32 = nDotV * (1. - k) + k;\n\n    return num / denom;\n}\n\nfn geometrySmith(normal: vec3f, viewDir: vec3f, lightDir: vec3f, roughness: f32) -> f32 {\n    let nDotV: f32 = max(dot(normal, viewDir), .0);\n    let nDotL: f32 = max(dot(normal, lightDir), .0);\n    let ggx2: f32  = geometrySchlickGGX(nDotV, roughness);\n    let ggx1: f32  = geometrySchlickGGX(nDotL, roughness);\n\n    return ggx1 * ggx2;\n}\n\nfn IntegrateBRDF(NdotV: f32, roughness: f32) -> vec2f {\n    var V: vec3f;\n    V.x = sqrt(1.0 - NdotV*NdotV);\n    V.y = 0.0;\n    V.z = NdotV;\n\n    var A: f32 = 0.0;\n    var B: f32 = 0.0;\n\n    let N: vec3f = vec3f(0.0, 0.0, 1.0);\n\n    const SAMPLE_COUNT: u32 = 1024u;\n    for(var i: u32 = 0u; i < SAMPLE_COUNT; i++) {\n        let Xi: vec2f = Hammersley(i, SAMPLE_COUNT);\n        let H: vec3f  = ImportanceSampleGGX(Xi, N, roughness);\n        let L: vec3f  = normalize(2.0 * dot(V, H) * H - V);\n\n        let NdotL: f32 = max(L.z, 0.0);\n        let NdotH: f32 = max(H.z, 0.0);\n        let VdotH: f32 = max(dot(V, H), 0.0);\n\n        if (NdotL > 0.0) {\n            let G: f32 = geometrySmith(N, V, L, roughness);\n            let G_Vis: f32 = (G * VdotH) / (NdotH * NdotV);\n            let Fc: f32 = pow(1.0 - VdotH, 5.0);\n\n            A += (1.0 - Fc) * G_Vis;\n            B += Fc * G_Vis;\n        }\n    }\n    A /= f32(SAMPLE_COUNT);\n    B /= f32(SAMPLE_COUNT);\n\n    return vec2f(A, B);\n}\n\n@fragment fn fs(\n    in: VSOut\n) -> @location(0) vec4f {\n    return vec4f(IntegrateBRDF((in.localPos.x + 1.0) * .5, (in.localPos.y + 1.0) * .5), 0., 1.);\n}\n";
//#endregion
//#region renderer/shaders/webgpu/mips.wgsl?raw
var mips_default = "struct VSOut {\n    @builtin(position) position: vec4f,\n    @location(0) texCoord: vec2f,\n};\n\n@vertex fn vs(\n    @location(0) position: vec2f\n) -> VSOut {\n    var vsOutput: VSOut;\n    vsOutput.position = vec4f(position * 2.0 - 1.0, 0.0, 1.0);\n    vsOutput.texCoord = vec2f(position.x, 1.0 - position.y);\n    return vsOutput;\n}\n\n@group(0) @binding(0) var textureSampler: sampler;\n@group(0) @binding(1) var textureView: texture_2d<f32>;\n\n@fragment fn fs(\n    fsInput: VSOut\n) -> @location(0) vec4f {\n    return textureSample(textureView, textureSampler, fsInput.texCoord);\n}";
//#endregion
//#region renderer/generateMips.ts
var sampler;
var module;
var buffer;
var pipelineByFormat = /* @__PURE__ */ new WeakMap();
function generateMips(device, texture) {
	if (!buffer) {
		buffer = device.createBuffer({
			label: "mips vertex buffer",
			size: 48,
			usage: GPUBufferUsage.VERTEX,
			mappedAtCreation: true
		});
		new Float32Array(buffer.getMappedRange(0, buffer.size)).set([
			0,
			0,
			1,
			0,
			0,
			1,
			0,
			1,
			1,
			0,
			1,
			1
		]);
		buffer.unmap();
		module = device.createShaderModule({
			label: "mips shader module",
			code: mips_default
		});
		sampler = device.createSampler({
			label: "mips sampler",
			minFilter: "linear"
		});
	}
	if (!pipelineByFormat[texture.format]) pipelineByFormat[texture.format] = device.createRenderPipeline({
		label: "mips pipeline",
		layout: "auto",
		vertex: {
			module,
			buffers: [{
				arrayStride: 8,
				attributes: [{
					shaderLocation: 0,
					offset: 0,
					format: "float32x2"
				}]
			}]
		},
		fragment: {
			module,
			targets: [{ format: texture.format }]
		}
	});
	const pipeline = pipelineByFormat[texture.format];
	const encoder = device.createCommandEncoder({ label: "mips encoder" });
	for (let i = 1; i < texture.mipLevelCount; ++i) for (let j = 0; j < texture.depthOrArrayLayers; ++j) {
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [{
				binding: 0,
				resource: sampler
			}, {
				binding: 1,
				resource: texture.createView({
					dimension: "2d",
					baseMipLevel: i - 1,
					mipLevelCount: 1,
					baseArrayLayer: j,
					arrayLayerCount: 1
				})
			}]
		});
		const renderPassDescriptor = {
			label: "mips render pass",
			colorAttachments: [{
				view: texture.createView({
					dimension: "2d",
					baseMipLevel: i,
					mipLevelCount: 1,
					baseArrayLayer: j,
					arrayLayerCount: 1
				}),
				loadOp: "clear",
				storeOp: "store"
			}]
		};
		const pass = encoder.beginRenderPass(renderPassDescriptor);
		pass.setPipeline(pipeline);
		pass.setVertexBuffer(0, buffer);
		pass.setBindGroup(0, bindGroup);
		pass.draw(6);
		pass.end();
	}
	const commandBuffer = encoder.finish();
	device.queue.submit([commandBuffer]);
}
//#endregion
//#region renderer/modelRenderer.ts
var MAX_NODES = 254;
var ENV_MAP_SIZE = 2048;
var ENV_CONVOLUTE_DIFFUSE_SIZE = 32;
var ENV_PREFILTER_SIZE = 128;
var MAX_ENV_MIP_LEVELS = 8;
var BRDF_LUT_SIZE = 512;
var MULTISAMPLE = 4;
var FILTER_MODES_WITH_DEPTH_WRITE = new Set([0, 1]);
var vertexShaderHardwareSkinning = /* @__PURE__ */ sdHardwareSkinning_vs_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES));
var vertexShaderHDHardwareSkinningOld = /* @__PURE__ */ hdHardwareSkinningOld_vs_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES));
var vertexShaderHDHardwareSkinningNew = /* @__PURE__ */ hdHardwareSkinningNew_vs_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES));
var fragmentShaderHDNew = /* @__PURE__ */ hdNew_fs_default.replace(/\$\{MAX_ENV_MIP_LEVELS}/g, String(MAX_ENV_MIP_LEVELS.toFixed(1)));
var sdShader = /* @__PURE__ */ sd_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES));
var hdShader = /* @__PURE__ */ hd_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES)).replace(/\$\{MAX_ENV_MIP_LEVELS}/g, String(MAX_ENV_MIP_LEVELS.toFixed(1)));
var depthShader = /* @__PURE__ */ depth_default.replace(/\$\{MAX_NODES}/g, String(MAX_NODES));
var translation = create$2();
var rotation = create();
var scaling = create$2();
var defaultTranslation = fromValues$2(0, 0, 0);
var defaultRotation = fromValues(0, 0, 0, 1);
var defaultScaling = fromValues$2(1, 1, 1);
var tempParentRotationQuat = create();
var tempParentRotationMat = create$3();
var tempCameraMat = create$3();
var tempTransformedPivotPoint = create$2();
var tempAxis = create$2();
var tempLockQuat = create();
var tempLockMat = create$3();
var tempXAxis = create$2();
var tempCameraVec = create$2();
var tempCross0 = create$2();
var tempCross1 = create$2();
var tempPos = create$2();
var tempSum = create$2();
var tempVec3 = create$2();
var identifyMat3 = create$4();
var texCoordMat4 = create$3();
var texCoordMat3 = create$4();
var GPU_LAYER_PROPS = [
	[
		"none",
		{
			color: {
				operation: "add",
				srcFactor: "one",
				dstFactor: "zero"
			},
			alpha: {
				operation: "add",
				srcFactor: "one",
				dstFactor: "zero"
			}
		},
		{
			depthWriteEnabled: true,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"transparent",
		{
			color: {
				operation: "add",
				srcFactor: "src-alpha",
				dstFactor: "one-minus-src-alpha"
			},
			alpha: {
				operation: "add",
				srcFactor: "one",
				dstFactor: "one-minus-src-alpha"
			}
		},
		{
			depthWriteEnabled: true,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"blend",
		{
			color: {
				operation: "add",
				srcFactor: "src-alpha",
				dstFactor: "one-minus-src-alpha"
			},
			alpha: {
				operation: "add",
				srcFactor: "one",
				dstFactor: "one-minus-src-alpha"
			}
		},
		{
			depthWriteEnabled: false,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"additive",
		{
			color: {
				operation: "add",
				srcFactor: "src",
				dstFactor: "one"
			},
			alpha: {
				operation: "add",
				srcFactor: "src",
				dstFactor: "one"
			}
		},
		{
			depthWriteEnabled: false,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"addAlpha",
		{
			color: {
				operation: "add",
				srcFactor: "src-alpha",
				dstFactor: "one"
			},
			alpha: {
				operation: "add",
				srcFactor: "src-alpha",
				dstFactor: "one"
			}
		},
		{
			depthWriteEnabled: false,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"modulate",
		{
			color: {
				operation: "add",
				srcFactor: "zero",
				dstFactor: "src"
			},
			alpha: {
				operation: "add",
				srcFactor: "zero",
				dstFactor: "one"
			}
		},
		{
			depthWriteEnabled: false,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	],
	[
		"modulate2x",
		{
			color: {
				operation: "add",
				srcFactor: "dst",
				dstFactor: "src"
			},
			alpha: {
				operation: "add",
				srcFactor: "zero",
				dstFactor: "one"
			}
		},
		{
			depthWriteEnabled: false,
			depthCompare: "less-equal",
			format: "depth24plus"
		}
	]
];
var ModelRenderer = class {
	constructor(model) {
		this.instanceAlpha = 1;
		this.instanceColor = new Float32Array([1, 1, 1]);
		this.gpuPipelines = {};
		this.vertexBuffer = [];
		this.normalBuffer = [];
		this.vertices = [];
		this.texCoordBuffer = [];
		this.indexBuffer = [];
		this.wireframeIndexBuffer = [];
		this.wireframeIndexGPUBuffer = [];
		this.groupBuffer = [];
		this.skinWeightBuffer = [];
		this.tangentBuffer = [];
		this.gpuVertexBuffer = [];
		this.gpuNormalBuffer = [];
		this.gpuTexCoordBuffer = [];
		this.gpuGroupBuffer = [];
		this.gpuIndexBuffer = [];
		this.gpuSkinWeightBuffer = [];
		this.gpuTangentBuffer = [];
		this.gpuFSUniformsBuffers = [];
		this.hasWeightedSkin = model.Geosets?.some((it) => it.SkinWeights?.length > 0);
		this.isHD = model.Materials.some((material) => material.Shader === "Shader_HD_DefaultUnit" || material.Layers.some((layer) => layer.ShaderTypeId === 1));
		this.shaderProgramLocations = {
			vertexPositionAttribute: null,
			normalsAttribute: null,
			textureCoordAttribute: null,
			groupAttribute: null,
			skinAttribute: null,
			weightAttribute: null,
			tangentAttribute: null,
			pMatrixUniform: null,
			mvMatrixUniform: null,
			samplerUniform: null,
			normalSamplerUniform: null,
			ormSamplerUniform: null,
			replaceableColorUniform: null,
			replaceableTypeUniform: null,
			discardAlphaLevelUniform: null,
			layerAlphaUniform: null,
			tVertexAnimUniform: null,
			wireframeUniform: null,
			nodesMatricesAttributes: null,
			lightPosUniform: null,
			lightColorUniform: null,
			cameraPosUniform: null,
			shadowParamsUniform: null,
			shadowMapSamplerUniform: null,
			shadowMapLightMatrixUniform: null,
			hasEnvUniform: null,
			irradianceMapUniform: null,
			prefilteredEnvUniform: null,
			brdfLUTUniform: null
		};
		this.skeletonShaderProgramLocations = {
			vertexPositionAttribute: null,
			colorAttribute: null,
			mvMatrixUniform: null,
			pMatrixUniform: null
		};
		this.model = model;
		this.rendererData = {
			model,
			frame: 0,
			animation: null,
			animationInfo: null,
			globalSequencesFrames: [],
			rootNode: null,
			nodes: [],
			geosetAnims: [],
			geosetAlpha: [],
			materialLayerTextureID: [],
			materialLayerNormalTextureID: [],
			materialLayerOrmTextureID: [],
			materialLayerReflectionTextureID: [],
			teamColor: null,
			cameraPos: null,
			cameraQuat: null,
			lightPos: null,
			lightColor: null,
			shadowBias: 0,
			shadowSmoothingStep: 0,
			textures: {},
			gpuTextures: {},
			gpuSamplers: [],
			gpuDepthSampler: null,
			gpuEmptyTexture: null,
			gpuEmptyCubeTexture: null,
			gpuDepthEmptyTexture: null,
			envTextures: {},
			gpuEnvTextures: {},
			requiredEnvMaps: {},
			irradianceMap: {},
			gpuIrradianceMap: {},
			prefilteredEnvMap: {},
			gpuPrefilteredEnvMap: {}
		};
		this.rendererData.teamColor = fromValues$2(1, 0, 0);
		this.rendererData.cameraPos = create$2();
		this.rendererData.cameraQuat = create();
		this.rendererData.lightPos = fromValues$2(1e3, 1e3, 1e3);
		this.rendererData.lightColor = fromValues$2(1, 1, 1);
		this.setSequence(0);
		this.rendererData.rootNode = {
			node: {},
			matrix: create$3(),
			childs: []
		};
		for (const node of model.Nodes) if (node) this.rendererData.nodes[node.ObjectId] = {
			node,
			matrix: create$3(),
			childs: []
		};
		for (const node of model.Nodes) if (node) if (!node.Parent && node.Parent !== 0) this.rendererData.rootNode.childs.push(this.rendererData.nodes[node.ObjectId]);
		else this.rendererData.nodes[node.Parent].childs.push(this.rendererData.nodes[node.ObjectId]);
		if (model.GlobalSequences) for (let i = 0; i < model.GlobalSequences.length; ++i) this.rendererData.globalSequencesFrames[i] = 0;
		for (let i = 0; i < model.GeosetAnims.length; ++i) this.rendererData.geosetAnims[model.GeosetAnims[i].GeosetId] = model.GeosetAnims[i];
		for (let i = 0; i < model.Materials.length; ++i) {
			this.rendererData.materialLayerTextureID[i] = new Array(model.Materials[i].Layers.length);
			this.rendererData.materialLayerNormalTextureID[i] = new Array(model.Materials[i].Layers.length);
			this.rendererData.materialLayerOrmTextureID[i] = new Array(model.Materials[i].Layers.length);
			this.rendererData.materialLayerReflectionTextureID[i] = new Array(model.Materials[i].Layers.length);
		}
		this.interp = new ModelInterp(this.rendererData);
		this.particlesController = new ParticlesController(this.interp, this.rendererData);
		this.ribbonsController = new RibbonsController(this.interp, this.rendererData);
	}
	destroy() {
		if (this.particlesController) {
			this.particlesController.destroy();
			this.particlesController = null;
		}
		if (this.ribbonsController) {
			this.ribbonsController.destroy();
			this.ribbonsController = null;
		}
		if (this.device) {
			for (const buffer of this.wireframeIndexGPUBuffer) buffer.destroy();
			this.gpuMultisampleTexture?.destroy();
			this.gpuDepthTexture?.destroy();
			for (const buffer of this.gpuVertexBuffer) buffer.destroy();
			for (const buffer of this.gpuNormalBuffer) buffer.destroy();
			for (const buffer of this.gpuTexCoordBuffer) buffer.destroy();
			for (const buffer of this.gpuGroupBuffer) buffer.destroy();
			for (const buffer of this.gpuIndexBuffer) buffer.destroy();
			for (const buffer of this.gpuSkinWeightBuffer) buffer.destroy();
			for (const buffer of this.gpuTangentBuffer) buffer.destroy();
			this.gpuVSUniformsBuffer?.destroy();
			for (const materialID in this.gpuFSUniformsBuffers) for (const buffer of this.gpuFSUniformsBuffers[materialID]) buffer.destroy();
			if (this.skeletonGPUVertexBuffer) {
				this.skeletonGPUVertexBuffer.destroy();
				this.skeletonGPUVertexBuffer = null;
			}
			if (this.skeletonGPUColorBuffer) {
				this.skeletonGPUColorBuffer.destroy();
				this.skeletonGPUColorBuffer = null;
			}
			if (this.skeletonGPUUniformsBuffer) {
				this.skeletonGPUUniformsBuffer.destroy();
				this.skeletonGPUUniformsBuffer = null;
			}
			if (this.envVSUniformsBuffer) {
				this.envVSUniformsBuffer.destroy();
				this.envVSUniformsBuffer = null;
			}
			if (this.cubeGPUVertexBuffer) {
				this.cubeGPUVertexBuffer.destroy();
				this.cubeGPUVertexBuffer = null;
			}
			for (const buffer of this.wireframeIndexGPUBuffer) buffer?.destroy();
		}
		if (this.gl) {
			if (this.skeletonShaderProgram) {
				if (this.skeletonVertexShader) {
					this.gl.detachShader(this.skeletonShaderProgram, this.skeletonVertexShader);
					this.gl.deleteShader(this.skeletonVertexShader);
					this.skeletonVertexShader = null;
				}
				if (this.skeletonFragmentShader) {
					this.gl.detachShader(this.skeletonShaderProgram, this.skeletonFragmentShader);
					this.gl.deleteShader(this.skeletonFragmentShader);
					this.skeletonFragmentShader = null;
				}
				this.gl.deleteProgram(this.skeletonShaderProgram);
				this.skeletonShaderProgram = null;
			}
			if (this.shaderProgram) {
				if (this.vertexShader) {
					this.gl.detachShader(this.shaderProgram, this.vertexShader);
					this.gl.deleteShader(this.vertexShader);
					this.vertexShader = null;
				}
				if (this.fragmentShader) {
					this.gl.detachShader(this.shaderProgram, this.fragmentShader);
					this.gl.deleteShader(this.fragmentShader);
					this.fragmentShader = null;
				}
				this.gl.deleteProgram(this.shaderProgram);
				this.shaderProgram = null;
			}
			this.destroyShaderProgramObject(this.envToCubemap);
			this.destroyShaderProgramObject(this.envSphere);
			this.destroyShaderProgramObject(this.convoluteDiffuseEnv);
			this.destroyShaderProgramObject(this.prefilterEnv);
			this.destroyShaderProgramObject(this.integrateBRDF);
			this.gl.deleteBuffer(this.cubeVertexBuffer);
			this.gl.deleteBuffer(this.squareVertexBuffer);
		}
	}
	initRequiredEnvMaps() {
		if (this.model.Version >= 1e3 && (isWebGL2(this.gl) || this.device)) this.model.Materials.forEach((material) => {
			let layer;
			if (material.Shader === "Shader_HD_DefaultUnit" && material.Layers.length === 6 && typeof material.Layers[5].TextureID === "number" || this.model.Version >= 1100 && (layer = material.Layers.find((it) => it.ShaderTypeId === 1 && it.ReflectionsTextureID)) && typeof layer.ReflectionsTextureID === "number") {
				const id = this.model.Version >= 1100 && layer ? layer.ReflectionsTextureID : material.Layers[5].TextureID;
				this.rendererData.requiredEnvMaps[this.model.Textures[id].Image] = true;
			}
		});
	}
	initGL(glContext) {
		this.gl = glContext;
		this.softwareSkinning = !this.isHD && this.hasWeightedSkin || this.gl.getParameter(this.gl.MAX_VERTEX_UNIFORM_VECTORS) < 4 * (MAX_NODES + 2);
		this.anisotropicExt = this.gl.getExtension("EXT_texture_filter_anisotropic") || this.gl.getExtension("MOZ_EXT_texture_filter_anisotropic") || this.gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
		this.colorBufferFloatExt = this.gl.getExtension("EXT_color_buffer_float");
		this.initRequiredEnvMaps();
		this.initShaders();
		this.initBuffers();
		this.initCube();
		this.initSquare();
		this.initBRDFLUT();
		this.particlesController.initGL(glContext);
		this.ribbonsController.initGL(glContext);
	}
	async initGPUDevice(canvas, device, context) {
		this.canvas = canvas;
		this.device = device;
		this.gpuContext = context;
		this.initRequiredEnvMaps();
		this.initGPUShaders();
		this.initGPUPipeline();
		this.initGPUBuffers();
		this.initGPUUniformBuffers();
		this.initGPUMultisampleTexture();
		this.initGPUDepthTexture();
		this.initGPUEmptyTexture();
		this.initCube();
		this.initGPUBRDFLUT();
		this.particlesController.initGPUDevice(device);
		this.ribbonsController.initGPUDevice(device);
	}
	setTextureImage(path, img) {
		if (this.device) {
			const texture = this.rendererData.gpuTextures[path] = this.device.createTexture({
				size: [img.width, img.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			this.device.queue.copyExternalImageToTexture({ source: img }, { texture }, {
				width: img.width,
				height: img.height
			});
			generateMips(this.device, texture);
			this.processEnvMaps(path);
		} else {
			this.rendererData.textures[path] = this.gl.createTexture();
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);
			this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
			const flags = this.model.Textures.find((it) => it.Image === path)?.Flags || 0;
			this.setTextureParameters(flags, true);
			this.gl.generateMipmap(this.gl.TEXTURE_2D);
			this.processEnvMaps(path);
			this.gl.bindTexture(this.gl.TEXTURE_2D, null);
		}
	}
	setTextureImageData(path, imageData) {
		let count = 1;
		for (let i = 1; i < imageData.length; ++i, ++count) if (imageData[i].width !== imageData[i - 1].width / 2 || imageData[i].height !== imageData[i - 1].height / 2) break;
		if (this.device) {
			const texture = this.rendererData.gpuTextures[path] = this.device.createTexture({
				size: [imageData[0].width, imageData[0].height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				mipLevelCount: count
			});
			for (let i = 0; i < count; ++i) this.device.queue.writeTexture({
				texture,
				mipLevel: i
			}, imageData[i].data, { bytesPerRow: imageData[i].width * 4 }, {
				width: imageData[i].width,
				height: imageData[i].height
			});
			this.processEnvMaps(path);
		} else {
			this.rendererData.textures[path] = this.gl.createTexture();
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);
			for (let i = 0; i < count; ++i) this.gl.texImage2D(this.gl.TEXTURE_2D, i, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData[i]);
			const flags = this.model.Textures.find((it) => it.Image === path)?.Flags || 0;
			this.setTextureParameters(flags, false);
			this.processEnvMaps(path);
			this.gl.bindTexture(this.gl.TEXTURE_2D, null);
		}
	}
	setTextureCompressedImage(path, format, imageData, ddsInfo) {
		this.rendererData.textures[path] = this.gl.createTexture();
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);
		const view = new Uint8Array(imageData);
		let count = 1;
		for (let i = 1; i < ddsInfo.images.length; ++i) {
			const image = ddsInfo.images[i];
			if (image.shape.width >= 2 && image.shape.height >= 2) count = i + 1;
		}
		if (isWebGL2(this.gl)) {
			this.gl.texStorage2D(this.gl.TEXTURE_2D, count, format, ddsInfo.images[0].shape.width, ddsInfo.images[0].shape.height);
			for (let i = 0; i < count; ++i) {
				const image = ddsInfo.images[i];
				this.gl.compressedTexSubImage2D(this.gl.TEXTURE_2D, i, 0, 0, image.shape.width, image.shape.height, format, view.subarray(image.offset, image.offset + image.length));
			}
		} else for (let i = 0; i < count; ++i) {
			const image = ddsInfo.images[i];
			this.gl.compressedTexImage2D(this.gl.TEXTURE_2D, i, format, image.shape.width, image.shape.height, 0, view.subarray(image.offset, image.offset + image.length));
		}
		const flags = this.model.Textures.find((it) => it.Image === path)?.Flags || 0;
		this.setTextureParameters(flags, isWebGL2(this.gl));
		this.processEnvMaps(path);
		this.gl.bindTexture(this.gl.TEXTURE_2D, null);
	}
	setGPUTextureCompressedImage(path, format, imageData, ddsInfo) {
		const view = new Uint8Array(imageData);
		let count = 1;
		for (let i = 1; i < ddsInfo.images.length; ++i) {
			const image = ddsInfo.images[i];
			if (image.shape.width >= 4 && image.shape.height >= 4) count = i + 1;
		}
		const texture = this.rendererData.gpuTextures[path] = this.device.createTexture({
			size: [ddsInfo.shape.width, ddsInfo.shape.height],
			format,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			mipLevelCount: count
		});
		for (let i = 0; i < count; ++i) {
			const image = ddsInfo.images[i];
			this.device.queue.writeTexture({
				texture,
				mipLevel: i
			}, view.subarray(image.offset, image.offset + image.length), { bytesPerRow: image.shape.width * (format === "bc1-rgba-unorm" ? 2 : 4) }, {
				width: image.shape.width,
				height: image.shape.height
			});
		}
		this.processEnvMaps(path);
	}
	setCamera(cameraPos, cameraQuat) {
		copy$2(this.rendererData.cameraPos, cameraPos);
		copy(this.rendererData.cameraQuat, cameraQuat);
	}
	/** Wisp: a directional key light and ambient fill (light direction in model space) and linear fog; undefined draws as upstream. */
	setWispEnvironment(environment) {
		this.wispEnvironment = environment;
	}
	applyWispEnvironment() {
		const at = this.shaderProgramLocations.wisp, environment = this.wispEnvironment;
		if (at === void 0) return;
		const light = environment?.light, fog = environment?.fog;
		this.gl.uniform4f(at.uWispLight, light?.direction[0] ?? 0, light?.direction[1] ?? 0, light?.direction[2] ?? 1, light === void 0 ? 0 : light.linear === true ? 2 : 1);
		this.gl.uniform3fv(at.uWispKey, light?.key ?? [1, 1, 1]);
		this.gl.uniform3fv(at.uWispAmbient, light?.ambient ?? [0, 0, 0]);
		this.gl.uniform4f(at.uWispFog, fog?.color[0] ?? 0, fog?.color[1] ?? 0, fog?.color[2] ?? 0, fog === void 0 ? 0 : 1);
		// Eye depth is near / (1 - depth * (1 - near / far)), which stays in range at medium precision.
		this.gl.uniform4f(at.uWispFogRange, fog?.start ?? 0, fog?.end ?? 1, fog?.near ?? 1, fog === void 0 ? 0 : 1 - fog.near / fog.far);
		this.gl.uniform1f(at.uWispFogMax, fog?.max ?? 1);
		this.gl.uniform3f(at.uWispLayer, 0, 0, 0);
		// Omni lights in world space, with the draw's model transform and normal matrix to carry fragments there.
		const shadow = environment?.shadow, pointShadow = environment?.pointShadow;
		this.gl.activeTexture(this.gl.TEXTURE7);
		this.gl.bindTexture(this.gl.TEXTURE_2D, shadow?.map ?? null);
		this.gl.uniform1i(at.uWispShadowMap, 7);
		this.gl.uniform4f(at.uWispShadow, shadow === void 0 ? 0 : 1, shadow?.bias ?? 0, shadow?.texel ?? 0, 0);
		if (shadow !== void 0) this.gl.uniformMatrix4fv(at.uWispShadowMatrix, false, shadow.matrix);
		this.gl.activeTexture(this.gl.TEXTURE8);
		this.gl.bindTexture(this.gl.TEXTURE_2D, pointShadow?.map ?? null);
		this.gl.uniform1i(at.uWispPointShadowMap, 8);
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.uniform4f(at.uWispPointShadow, pointShadow?.near ?? 1, pointShadow?.far ?? 2, pointShadow?.texel ?? 0, 0);
		if (pointShadow !== void 0) this.gl.uniformMatrix4fv(at.uWispPointShadowMatrix, false, pointShadow.matrices);
		const points = environment?.points, lights = points?.lights ?? [];
		const casters = [0, 1].map((slot) => pointShadow === void 0 ? -1 : lights.slice(0, 8).findIndex((light) => light.shadowSlot === slot));
		this.gl.uniform2f(at.uWispPointCaster, casters[0], casters[1]);
		this.gl.uniform3fv(at.uWispPointCasterPos, new Float32Array(casters.flatMap((index) => index < 0 ? [0, 0, 0] : Array.from(lights[index].position))));
		this.gl.uniform1i(at.uWispPointCount, Math.min(lights.length, 8));
		if (lights.length > 0) {
			const pick = (read) => new Float32Array(lights.slice(0, 8).flatMap(read));
			this.gl.uniform3fv(at.uWispPointPos, pick((light) => light.position));
			this.gl.uniform3fv(at.uWispPointColor, pick((light) => light.color));
			this.gl.uniform2fv(at.uWispPointRange, pick((light) => [light.start, light.end]));
			this.gl.uniformMatrix4fv(at.uWispModel, false, points.model);
			this.gl.uniformMatrix3fv(at.uWispNormal, false, points.normal);
		}
	}
	setWispLayer(layer) {
		const at = this.shaderProgramLocations.wisp;
		if (at === void 0) return;
		const additive = layer.FilterMode === FilterMode.Additive || layer.FilterMode === FilterMode.AddAlpha;
		this.gl.uniform3f(at.uWispLayer, layer.Shading & LayerShading.Unshaded ? 1 : 0, layer.Shading & LayerShading.Unfogged ? 1 : 0, additive ? 1 : 0);
	}
	setLightPosition(lightPos) {
		copy$2(this.rendererData.lightPos, lightPos);
	}
	setLightColor(lightColor) {
		copy$2(this.rendererData.lightColor, lightColor);
	}
	setSequence(index) {
		this.rendererData.animation = index;
		this.rendererData.animationInfo = this.model.Sequences[this.rendererData.animation];
		this.rendererData.frame = this.rendererData.animationInfo.Interval[0];
	}
	getSequence() {
		return this.rendererData.animation;
	}
	setFrame(frame) {
		const index = this.model.Sequences.findIndex((it) => it.Interval[0] <= frame && it.Interval[1] >= frame);
		if (index < 0) return;
		this.rendererData.animation = index;
		this.rendererData.animationInfo = this.model.Sequences[this.rendererData.animation];
		this.rendererData.frame = frame;
	}
	getFrame() {
		return this.rendererData.frame;
	}
	setTeamColor(color) {
		copy$2(this.rendererData.teamColor, color);
	}
	update(delta) {
		this.rendererData.frame += delta;
		if (this.rendererData.frame > this.rendererData.animationInfo.Interval[1]) this.rendererData.frame = this.rendererData.animationInfo.Interval[0];
		this.updateGlobalSequences(delta);
		this.updateNode(this.rendererData.rootNode);
		this.particlesController.update(delta);
		this.ribbonsController.update(delta);
		for (let i = 0; i < this.model.Geosets.length; ++i) this.rendererData.geosetAlpha[i] = this.findAlpha(i);
		for (let materialId = 0; materialId < this.rendererData.materialLayerTextureID.length; ++materialId) for (let layerId = 0; layerId < this.rendererData.materialLayerTextureID[materialId].length; ++layerId) {
			const layer = this.model.Materials[materialId].Layers[layerId];
			const TextureID = layer.TextureID;
			const NormalTextureID = layer.NormalTextureID;
			const ORMTextureID = layer.ORMTextureID;
			const ReflectionsTextureID = layer.ReflectionsTextureID;
			if (typeof TextureID === "number") this.rendererData.materialLayerTextureID[materialId][layerId] = TextureID;
			else this.rendererData.materialLayerTextureID[materialId][layerId] = this.interp.num(TextureID);
			if (typeof NormalTextureID !== "undefined") this.rendererData.materialLayerNormalTextureID[materialId][layerId] = typeof NormalTextureID === "number" ? NormalTextureID : this.interp.num(NormalTextureID);
			if (typeof ORMTextureID !== "undefined") this.rendererData.materialLayerOrmTextureID[materialId][layerId] = typeof ORMTextureID === "number" ? ORMTextureID : this.interp.num(ORMTextureID);
			if (typeof ReflectionsTextureID !== "undefined") this.rendererData.materialLayerReflectionTextureID[materialId][layerId] = typeof ReflectionsTextureID === "number" ? ReflectionsTextureID : this.interp.num(ReflectionsTextureID);
		}
	}
	render(mvMatrix, pMatrix, { wireframe, env, levelOfDetail = 0, useEnvironmentMap = false, shadowMapTexture, shadowMapMatrix, shadowBias, shadowSmoothingStep, depthTextureTarget }) {
		if (depthTextureTarget && !this.isHD) return;
		if (this.device) {
			if (this.gpuMultisampleTexture.width !== this.canvas.width || this.gpuMultisampleTexture.height !== this.canvas.height) {
				this.gpuMultisampleTexture.destroy();
				this.initGPUMultisampleTexture();
			}
			if (this.gpuDepthTexture.width !== this.canvas.width || this.gpuDepthTexture.height !== this.canvas.height) {
				this.gpuDepthTexture.destroy();
				this.initGPUDepthTexture();
			}
			let renderPassDescriptor;
			if (depthTextureTarget) renderPassDescriptor = {
				label: "shadow renderPass",
				colorAttachments: [],
				depthStencilAttachment: {
					view: depthTextureTarget.createView(),
					depthClearValue: 1,
					depthLoadOp: "clear",
					depthStoreOp: "store"
				}
			};
			else {
				renderPassDescriptor = this.gpuRenderPassDescriptor;
				if (MULTISAMPLE > 1) {
					this.gpuRenderPassDescriptor.colorAttachments[0].view = this.gpuMultisampleTexture.createView();
					this.gpuRenderPassDescriptor.colorAttachments[0].resolveTarget = this.gpuContext.getCurrentTexture().createView();
				} else this.gpuRenderPassDescriptor.colorAttachments[0].view = this.gpuContext.getCurrentTexture().createView();
				this.gpuRenderPassDescriptor.depthStencilAttachment = {
					view: this.gpuDepthTexture.createView(),
					depthClearValue: 1,
					depthLoadOp: "clear",
					depthStoreOp: "store"
				};
			}
			const encoder = this.device.createCommandEncoder();
			const pass = encoder.beginRenderPass(renderPassDescriptor);
			if (env) this.renderEnvironmentGPU(pass, mvMatrix, pMatrix);
			const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128 + 64 * MAX_NODES);
			const VSUniformsViews = {
				mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
				pMatrix: new Float32Array(VSUniformsValues, 64, 16),
				nodesMatrices: new Float32Array(VSUniformsValues, 128, 16 * MAX_NODES)
			};
			VSUniformsViews.mvMatrix.set(mvMatrix);
			VSUniformsViews.pMatrix.set(pMatrix);
			for (let j = 0; j < MAX_NODES; ++j) if (this.rendererData.nodes[j]) VSUniformsViews.nodesMatrices.set(this.rendererData.nodes[j].matrix, j * 16);
			this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);
			for (let i = 0; i < this.model.Geosets.length; ++i) {
				const geoset = this.model.Geosets[i];
				if (this.rendererData.geosetAlpha[i] < 1e-6) continue;
				if (geoset.LevelOfDetail !== void 0 && geoset.LevelOfDetail !== levelOfDetail) continue;
				if (wireframe && !this.wireframeIndexGPUBuffer[i]) this.createWireframeGPUBuffer(i);
				const materialID = geoset.MaterialID;
				const material = this.model.Materials[materialID];
				pass.setVertexBuffer(0, this.gpuVertexBuffer[i]);
				pass.setVertexBuffer(1, this.gpuNormalBuffer[i]);
				pass.setVertexBuffer(2, this.gpuTexCoordBuffer[i]);
				if (this.isHD) {
					pass.setVertexBuffer(3, this.gpuTangentBuffer[i]);
					pass.setVertexBuffer(4, this.gpuSkinWeightBuffer[i]);
					pass.setVertexBuffer(5, this.gpuSkinWeightBuffer[i]);
				} else pass.setVertexBuffer(3, this.gpuGroupBuffer[i]);
				pass.setIndexBuffer(wireframe ? this.wireframeIndexGPUBuffer[i] : this.gpuIndexBuffer[i], "uint16");
				if (this.isHD) {
					const baseLayer = material.Layers[0];
					if (depthTextureTarget && !FILTER_MODES_WITH_DEPTH_WRITE.has(baseLayer.FilterMode || 0)) continue;
					const pipeline = depthTextureTarget ? this.gpuShadowPipeline : wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(baseLayer);
					pass.setPipeline(pipeline);
					const textures = this.rendererData.materialLayerTextureID[materialID];
					const normalTextres = this.rendererData.materialLayerNormalTextureID[materialID];
					const ormTextres = this.rendererData.materialLayerOrmTextureID[materialID];
					const envTextres = this.rendererData.materialLayerReflectionTextureID[materialID];
					const diffuseTextureID = textures[0];
					const diffuseTexture = this.model.Textures[diffuseTextureID];
					const normalTextureID = baseLayer?.ShaderTypeId === 1 ? normalTextres[0] : textures[1];
					const normalTexture = this.model.Textures[normalTextureID];
					const ormTextureID = baseLayer?.ShaderTypeId === 1 ? ormTextres[0] : textures[2];
					const ormTexture = this.model.Textures[ormTextureID];
					const envTextureID = baseLayer?.ShaderTypeId === 1 ? envTextres[0] : textures[5];
					const envTextureImage = this.model.Textures[envTextureID]?.Image;
					const irradianceMap = this.rendererData.gpuIrradianceMap[envTextureImage];
					const prefilteredEnv = this.rendererData.gpuPrefilteredEnvMap[envTextureImage];
					const hasEnv = env && irradianceMap && prefilteredEnv;
					this.gpuFSUniformsBuffers[materialID] ||= [];
					let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0];
					if (!gpuFSUniformsBuffer) gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0] = this.device.createBuffer({
						label: `fs uniforms ${materialID}`,
						size: 192,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
					});
					const tVetexAnim = this.getTexCoordMatrix(baseLayer);
					const FSUniformsValues = /* @__PURE__ */ new ArrayBuffer(192);
					const FSUniformsViews = {
						replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
						discardAlphaLevel: new Float32Array(FSUniformsValues, 12, 1),
						tVertexAnim: new Float32Array(FSUniformsValues, 16, 12),
						lightPos: new Float32Array(FSUniformsValues, 64, 3),
						hasEnv: new Uint32Array(FSUniformsValues, 76, 1),
						lightColor: new Float32Array(FSUniformsValues, 80, 3),
						wireframe: new Uint32Array(FSUniformsValues, 92, 1),
						cameraPos: new Float32Array(FSUniformsValues, 96, 3),
						shadowParams: new Float32Array(FSUniformsValues, 112, 3),
						shadowMapLightMatrix: new Float32Array(FSUniformsValues, 128, 16)
					};
					FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
					FSUniformsViews.discardAlphaLevel.set([baseLayer.FilterMode === FilterMode.Transparent ? .75 : 0]);
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
					FSUniformsViews.lightPos.set(this.rendererData.lightPos);
					FSUniformsViews.lightColor.set(this.rendererData.lightColor);
					FSUniformsViews.cameraPos.set(this.rendererData.cameraPos);
					if (shadowMapTexture && shadowMapMatrix) {
						FSUniformsViews.shadowParams.set([
							1,
							shadowBias ?? 1e-6,
							shadowSmoothingStep ?? 1 / 1024
						]);
						FSUniformsViews.shadowMapLightMatrix.set(shadowMapMatrix);
					} else {
						FSUniformsViews.shadowParams.set([
							0,
							0,
							0
						]);
						FSUniformsViews.shadowMapLightMatrix.set([
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0
						]);
					}
					FSUniformsViews.hasEnv.set([hasEnv ? 1 : 0]);
					FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
					this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);
					const fsBindGroup = this.device.createBindGroup({
						label: `fs uniforms ${materialID}`,
						layout: this.fsBindGroupLayout,
						entries: [
							{
								binding: 0,
								resource: { buffer: gpuFSUniformsBuffer }
							},
							{
								binding: 1,
								resource: this.rendererData.gpuSamplers[diffuseTextureID]
							},
							{
								binding: 2,
								resource: (this.rendererData.gpuTextures[diffuseTexture.Image] || this.rendererData.gpuEmptyTexture).createView()
							},
							{
								binding: 3,
								resource: this.rendererData.gpuSamplers[normalTextureID]
							},
							{
								binding: 4,
								resource: (this.rendererData.gpuTextures[normalTexture.Image] || this.rendererData.gpuEmptyTexture).createView()
							},
							{
								binding: 5,
								resource: this.rendererData.gpuSamplers[ormTextureID]
							},
							{
								binding: 6,
								resource: (this.rendererData.gpuTextures[ormTexture.Image] || this.rendererData.gpuEmptyTexture).createView()
							},
							{
								binding: 7,
								resource: this.rendererData.gpuDepthSampler
							},
							{
								binding: 8,
								resource: (shadowMapTexture || this.rendererData.gpuDepthEmptyTexture).createView()
							},
							{
								binding: 9,
								resource: this.prefilterEnvSampler
							},
							{
								binding: 10,
								resource: (irradianceMap || this.rendererData.gpuEmptyCubeTexture).createView({ dimension: "cube" })
							},
							{
								binding: 11,
								resource: this.prefilterEnvSampler
							},
							{
								binding: 12,
								resource: (prefilteredEnv || this.rendererData.gpuEmptyCubeTexture).createView({ dimension: "cube" })
							},
							{
								binding: 13,
								resource: this.gpuBrdfSampler
							},
							{
								binding: 14,
								resource: this.gpuBrdfLUT.createView()
							}
						]
					});
					pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
					pass.setBindGroup(1, fsBindGroup);
					pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
				} else for (let j = 0; j < material.Layers.length; ++j) {
					const layer = material.Layers[j];
					const textureID = this.rendererData.materialLayerTextureID[materialID][j];
					const texture = this.model.Textures[textureID];
					const pipeline = wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(layer);
					pass.setPipeline(pipeline);
					this.gpuFSUniformsBuffers[materialID] ||= [];
					let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j];
					if (!gpuFSUniformsBuffer) gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j] = this.device.createBuffer({
						label: `fs uniforms ${materialID} ${j}`,
						size: 80,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
					});
					const tVetexAnim = this.getTexCoordMatrix(layer);
					const FSUniformsValues = /* @__PURE__ */ new ArrayBuffer(80);
					const FSUniformsViews = {
						replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
						replaceableType: new Uint32Array(FSUniformsValues, 12, 1),
						discardAlphaLevel: new Float32Array(FSUniformsValues, 16, 1),
						wireframe: new Uint32Array(FSUniformsValues, 20, 1),
						tVertexAnim: new Float32Array(FSUniformsValues, 32, 12)
					};
					FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
					FSUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
					FSUniformsViews.discardAlphaLevel.set([layer.FilterMode === FilterMode.Transparent ? .75 : 0]);
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
					FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
					FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
					this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);
					const fsBindGroup = this.device.createBindGroup({
						label: `fs uniforms ${materialID} ${j}`,
						layout: this.fsBindGroupLayout,
						entries: [
							{
								binding: 0,
								resource: { buffer: gpuFSUniformsBuffer }
							},
							{
								binding: 1,
								resource: this.rendererData.gpuSamplers[textureID]
							},
							{
								binding: 2,
								resource: (this.rendererData.gpuTextures[texture.Image] || this.rendererData.gpuEmptyTexture).createView()
							}
						]
					});
					pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
					pass.setBindGroup(1, fsBindGroup);
					pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
				}
			}
			this.particlesController.renderGPU(pass, mvMatrix, pMatrix);
			this.ribbonsController.renderGPU(pass, mvMatrix, pMatrix);
			pass.end();
			const commandBuffer = encoder.finish();
			this.device.queue.submit([commandBuffer]);
			return;
		}
		if (env) this.renderEnvironment(mvMatrix, pMatrix);
		this.gl.useProgram(this.shaderProgram);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
		this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);
		this.gl.uniform1f(this.shaderProgramLocations.wireframeUniform, wireframe ? 1 : 0);
		this.applyWispEnvironment();
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
		this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
		if (this.isHD) {
			this.gl.enableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
			this.gl.enableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
			this.gl.enableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
		} else if (!this.softwareSkinning) this.gl.enableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
		if (!this.softwareSkinning) {
			for (let j = 0; j < MAX_NODES; ++j) if (this.rendererData.nodes[j]) this.gl.uniformMatrix4fv(this.shaderProgramLocations.nodesMatricesAttributes[j], false, this.rendererData.nodes[j].matrix);
		}
		for (let i = 0; i < this.model.Geosets.length; ++i) {
			const geoset = this.model.Geosets[i];
			if (this.rendererData.geosetAlpha[i] < 1e-6) continue;
			if (geoset.LevelOfDetail !== void 0 && geoset.LevelOfDetail !== levelOfDetail) continue;
			if (this.softwareSkinning) this.generateGeosetVertices(i);
			const materialID = geoset.MaterialID;
			const material = this.model.Materials[materialID];
			if (this.isHD) {
				this.gl.uniform3fv(this.shaderProgramLocations.lightPosUniform, this.rendererData.lightPos);
				this.gl.uniform3fv(this.shaderProgramLocations.lightColorUniform, this.rendererData.lightColor);
				this.gl.uniform3fv(this.shaderProgramLocations.cameraPosUniform, this.rendererData.cameraPos);
				if (shadowMapTexture && shadowMapMatrix) {
					this.gl.uniform3f(this.shaderProgramLocations.shadowParamsUniform, 1, shadowBias ?? 1e-6, shadowSmoothingStep ?? 1 / 1024);
					this.gl.activeTexture(this.gl.TEXTURE3);
					this.gl.bindTexture(this.gl.TEXTURE_2D, shadowMapTexture);
					this.gl.uniform1i(this.shaderProgramLocations.shadowMapSamplerUniform, 3);
					this.gl.uniformMatrix4fv(this.shaderProgramLocations.shadowMapLightMatrixUniform, false, shadowMapMatrix);
				} else this.gl.uniform3f(this.shaderProgramLocations.shadowParamsUniform, 0, 0, 0);
				const envTextureId = this.model.Version >= 1100 && material.Layers.find((it) => it.ShaderTypeId === 1 && typeof it.ReflectionsTextureID === "number")?.ReflectionsTextureID || material.Layers[5]?.TextureID;
				const envTexture = this.model.Textures[envTextureId]?.Image;
				const irradianceMap = this.rendererData.irradianceMap[envTexture];
				const prefilteredEnv = this.rendererData.prefilteredEnvMap[envTexture];
				if (useEnvironmentMap && irradianceMap && prefilteredEnv) {
					this.gl.uniform1i(this.shaderProgramLocations.hasEnvUniform, 1);
					this.gl.activeTexture(this.gl.TEXTURE4);
					this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, irradianceMap);
					this.gl.uniform1i(this.shaderProgramLocations.irradianceMapUniform, 4);
					this.gl.activeTexture(this.gl.TEXTURE5);
					this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, prefilteredEnv);
					this.gl.uniform1i(this.shaderProgramLocations.prefilteredEnvUniform, 5);
					this.gl.activeTexture(this.gl.TEXTURE6);
					this.gl.bindTexture(this.gl.TEXTURE_2D, this.brdfLUT);
					this.gl.uniform1i(this.shaderProgramLocations.brdfLUTUniform, 6);
				} else {
					this.gl.uniform1i(this.shaderProgramLocations.hasEnvUniform, 0);
					this.gl.uniform1i(this.shaderProgramLocations.irradianceMapUniform, 4);
					this.gl.uniform1i(this.shaderProgramLocations.prefilteredEnvUniform, 5);
					this.gl.uniform1i(this.shaderProgramLocations.brdfLUTUniform, 6);
				}
				this.setLayerAlpha(i, material.Layers[0]);
				this.setLayerPropsHD(materialID, material.Layers);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.normalsAttribute, 3, this.gl.FLOAT, false, 0, 0);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skinWeightBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.skinAttribute, 4, this.gl.UNSIGNED_BYTE, false, 8, 0);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.weightAttribute, 4, this.gl.UNSIGNED_BYTE, true, 8, 4);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.tangentBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.tangentAttribute, 4, this.gl.FLOAT, false, 0, 0);
				if (wireframe && !this.wireframeIndexBuffer[i]) this.createWireframeBuffer(i);
				this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, wireframe ? this.wireframeIndexBuffer[i] : this.indexBuffer[i]);
				this.gl.drawElements(wireframe ? this.gl.LINES : this.gl.TRIANGLES, wireframe ? geoset.Faces.length * 2 : geoset.Faces.length, this.gl.UNSIGNED_SHORT, 0);
				if (shadowMapTexture && shadowMapMatrix) {
					this.gl.activeTexture(this.gl.TEXTURE3);
					this.gl.bindTexture(this.gl.TEXTURE_2D, null);
				}
			} else for (let j = 0; j < material.Layers.length; ++j) {
				this.setLayerAlpha(i, material.Layers[j]);
				this.setLayerProps(material.Layers[j], this.rendererData.materialLayerTextureID[materialID][j]);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.normalsAttribute, 3, this.gl.FLOAT, false, 0, 0);
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
				this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);
				if (!this.softwareSkinning) {
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
					this.gl.vertexAttribPointer(this.shaderProgramLocations.groupAttribute, 4, this.gl.UNSIGNED_SHORT, false, 0, 0);
				}
				if (wireframe && !this.wireframeIndexBuffer[i]) this.createWireframeBuffer(i);
				this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, wireframe ? this.wireframeIndexBuffer[i] : this.indexBuffer[i]);
				this.gl.drawElements(wireframe ? this.gl.LINES : this.gl.TRIANGLES, wireframe ? geoset.Faces.length * 2 : geoset.Faces.length, this.gl.UNSIGNED_SHORT, 0);
			}
		}
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
		this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
		if (this.isHD) {
			this.gl.disableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
			this.gl.disableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
			this.gl.disableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
		} else if (!this.softwareSkinning) this.gl.disableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
		this.particlesController.render(mvMatrix, pMatrix);
		this.ribbonsController.render(mvMatrix, pMatrix);
	}
	renderEnvironmentGPU(pass, mvMatrix, pMatrix) {
		pass.setPipeline(this.envPiepeline);
		const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
		const VSUniformsViews = {
			mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
			pMatrix: new Float32Array(VSUniformsValues, 64, 16)
		};
		VSUniformsViews.mvMatrix.set(mvMatrix);
		VSUniformsViews.pMatrix.set(pMatrix);
		this.device.queue.writeBuffer(this.envVSUniformsBuffer, 0, VSUniformsValues);
		pass.setBindGroup(0, this.envVSBindGroup);
		for (const path in this.rendererData.gpuEnvTextures) {
			const fsUniformsBindGroup = this.device.createBindGroup({
				label: `env fs uniforms ${path}`,
				layout: this.envFSBindGroupLayout,
				entries: [{
					binding: 0,
					resource: this.envSampler
				}, {
					binding: 1,
					resource: this.rendererData.gpuEnvTextures[path].createView({ dimension: "cube" })
				}]
			});
			pass.setBindGroup(1, fsUniformsBindGroup);
			pass.setPipeline(this.envPiepeline);
			pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);
			pass.draw(36);
		}
	}
	renderEnvironment(mvMatrix, pMatrix) {
		if (!isWebGL2(this.gl)) return;
		this.gl.disable(this.gl.BLEND);
		this.gl.disable(this.gl.DEPTH_TEST);
		this.gl.disable(this.gl.CULL_FACE);
		for (const path in this.rendererData.envTextures) {
			this.gl.useProgram(this.envSphere.program);
			this.gl.uniformMatrix4fv(this.envSphere.uniforms.uPMatrix, false, pMatrix);
			this.gl.uniformMatrix4fv(this.envSphere.uniforms.uMVMatrix, false, mvMatrix);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
			this.gl.uniform1i(this.envSphere.uniforms.uEnvironmentMap, 0);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
			this.gl.enableVertexAttribArray(this.envSphere.attributes.aPos);
			this.gl.vertexAttribPointer(this.envSphere.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.drawArrays(this.gl.TRIANGLES, 0, 36);
			this.gl.disableVertexAttribArray(this.envSphere.attributes.aPos);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
		}
	}
	/**
	* @param mvMatrix
	* @param pMatrix
	* @param nodes Nodes to highlight. null means draw all
	*/
	renderSkeleton(mvMatrix, pMatrix, nodes) {
		const coords = [];
		const colors = [];
		const line = (node0, node1) => {
			transformMat4(tempPos, node0.node.PivotPoint, node0.matrix);
			coords.push(tempPos[0], tempPos[1], tempPos[2]);
			transformMat4(tempPos, node1.node.PivotPoint, node1.matrix);
			coords.push(tempPos[0], tempPos[1], tempPos[2]);
			colors.push(0, 1, 0, 0, 0, 1);
		};
		const updateNode = (node) => {
			if ((node.node.Parent || node.node.Parent === 0) && (!nodes || nodes.includes(node.node.Name))) line(node, this.rendererData.nodes[node.node.Parent]);
			for (const child of node.childs) updateNode(child);
		};
		updateNode(this.rendererData.rootNode);
		if (!coords.length) return;
		const vertexBuffer = new Float32Array(coords);
		const colorBuffer = new Float32Array(colors);
		if (this.device) {
			if (!this.skeletonShaderModule) this.skeletonShaderModule = this.device.createShaderModule({
				label: "skeleton",
				code: skeleton_default
			});
			if (!this.skeletonBindGroupLayout) this.skeletonBindGroupLayout = this.device.createBindGroupLayout({
				label: "skeleton bind group layout",
				entries: [{
					binding: 0,
					visibility: GPUShaderStage.VERTEX,
					buffer: {
						type: "uniform",
						hasDynamicOffset: false,
						minBindingSize: 128
					}
				}]
			});
			if (!this.skeletonPipelineLayout) this.skeletonPipelineLayout = this.device.createPipelineLayout({
				label: "skeleton pipeline layout",
				bindGroupLayouts: [this.skeletonBindGroupLayout]
			});
			if (!this.skeletonPipeline) this.skeletonPipeline = this.device.createRenderPipeline({
				label: "skeleton pipeline",
				layout: this.skeletonPipelineLayout,
				vertex: {
					module: this.skeletonShaderModule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}, {
						arrayStride: 12,
						attributes: [{
							shaderLocation: 1,
							offset: 0,
							format: "float32x3"
						}]
					}]
				},
				fragment: {
					module: this.skeletonShaderModule,
					targets: [{
						format: navigator.gpu.getPreferredCanvasFormat(),
						blend: {
							color: {
								operation: "add",
								srcFactor: "src-alpha",
								dstFactor: "one-minus-src-alpha"
							},
							alpha: {
								operation: "add",
								srcFactor: "one",
								dstFactor: "one-minus-src-alpha"
							}
						}
					}]
				},
				primitive: { topology: "line-list" }
			});
			this.skeletonGPUVertexBuffer?.destroy();
			this.skeletonGPUColorBuffer?.destroy();
			this.skeletonGPUUniformsBuffer?.destroy();
			const vertex = this.skeletonGPUVertexBuffer = this.device.createBuffer({
				label: "skeleton vertex",
				size: vertexBuffer.byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(vertex.getMappedRange(0, vertex.size)).set(vertexBuffer);
			vertex.unmap();
			const color = this.skeletonGPUColorBuffer = this.device.createBuffer({
				label: "skeleton color",
				size: colorBuffer.byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(color.getMappedRange(0, color.size)).set(colorBuffer);
			color.unmap();
			const uniformsBuffer = this.skeletonGPUUniformsBuffer = this.device.createBuffer({
				label: "skeleton vs uniforms",
				size: 128,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			const uniformsBindGroup = this.device.createBindGroup({
				label: "skeleton uniforms bind group",
				layout: this.skeletonBindGroupLayout,
				entries: [{
					binding: 0,
					resource: { buffer: uniformsBuffer }
				}]
			});
			const renderPassDescriptor = {
				label: "skeleton renderPass",
				colorAttachments: [{
					view: this.gpuContext.getCurrentTexture().createView(),
					clearValue: [
						.15,
						.15,
						.15,
						1
					],
					loadOp: "load",
					storeOp: "store"
				}]
			};
			const encoder = this.device.createCommandEncoder();
			const pass = encoder.beginRenderPass(renderPassDescriptor);
			const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
			const VSUniformsViews = {
				mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
				pMatrix: new Float32Array(VSUniformsValues, 64, 16)
			};
			VSUniformsViews.mvMatrix.set(mvMatrix);
			VSUniformsViews.pMatrix.set(pMatrix);
			this.device.queue.writeBuffer(uniformsBuffer, 0, VSUniformsValues);
			pass.setVertexBuffer(0, vertex);
			pass.setVertexBuffer(1, color);
			pass.setPipeline(this.skeletonPipeline);
			pass.setBindGroup(0, uniformsBindGroup);
			pass.draw(vertexBuffer.length / 3);
			pass.end();
			const commandBuffer = encoder.finish();
			this.device.queue.submit([commandBuffer]);
			return;
		}
		if (!this.skeletonShaderProgram) this.skeletonShaderProgram = this.initSkeletonShaderProgram();
		this.gl.disable(this.gl.BLEND);
		this.gl.disable(this.gl.DEPTH_TEST);
		this.gl.useProgram(this.skeletonShaderProgram);
		this.gl.uniformMatrix4fv(this.skeletonShaderProgramLocations.pMatrixUniform, false, pMatrix);
		this.gl.uniformMatrix4fv(this.skeletonShaderProgramLocations.mvMatrixUniform, false, mvMatrix);
		this.gl.enableVertexAttribArray(this.skeletonShaderProgramLocations.vertexPositionAttribute);
		this.gl.enableVertexAttribArray(this.skeletonShaderProgramLocations.colorAttribute);
		if (!this.skeletonVertexBuffer) this.skeletonVertexBuffer = this.gl.createBuffer();
		if (!this.skeletonColorBuffer) this.skeletonColorBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skeletonVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexBuffer, this.gl.DYNAMIC_DRAW);
		this.gl.vertexAttribPointer(this.skeletonShaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skeletonColorBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, colorBuffer, this.gl.DYNAMIC_DRAW);
		this.gl.vertexAttribPointer(this.skeletonShaderProgramLocations.colorAttribute, 3, this.gl.FLOAT, false, 0, 0);
		this.gl.drawArrays(this.gl.LINES, 0, vertexBuffer.length / 3);
		this.gl.disableVertexAttribArray(this.skeletonShaderProgramLocations.vertexPositionAttribute);
		this.gl.disableVertexAttribArray(this.skeletonShaderProgramLocations.colorAttribute);
	}
	initSkeletonShaderProgram() {
		const vertex = this.skeletonVertexShader = getShader(this.gl, skeleton_vs_default, this.gl.VERTEX_SHADER);
		const fragment = this.skeletonFragmentShader = getShader(this.gl, skeleton_fs_default, this.gl.FRAGMENT_SHADER);
		const shaderProgram = this.gl.createProgram();
		this.gl.attachShader(shaderProgram, vertex);
		this.gl.attachShader(shaderProgram, fragment);
		this.gl.linkProgram(shaderProgram);
		if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) alert("Could not initialise shaders");
		this.gl.useProgram(shaderProgram);
		this.skeletonShaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, "aVertexPosition");
		this.skeletonShaderProgramLocations.colorAttribute = this.gl.getAttribLocation(shaderProgram, "aColor");
		this.skeletonShaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uPMatrix");
		this.skeletonShaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uMVMatrix");
		return shaderProgram;
	}
	generateGeosetVertices(geosetIndex) {
		const geoset = this.model.Geosets[geosetIndex];
		const buffer = this.vertices[geosetIndex];
		for (let i = 0; i < buffer.length; i += 3) {
			const index = i / 3;
			set$2(tempPos, geoset.Vertices[i], geoset.Vertices[i + 1], geoset.Vertices[i + 2]);
			set$2(tempSum, 0, 0, 0);
			if (geoset.SkinWeights?.length > 0) {
				const offset = index * 8;
				for (let j = 0; j < 4; ++j) {
					const weight = geoset.SkinWeights[offset + 4 + j] / 255;
					if (weight === 0) continue;
					const node = this.rendererData.nodes[geoset.SkinWeights[offset + j]];
					scaleAndAdd(tempSum, tempSum, transformMat4(tempVec3, tempPos, node.matrix), weight);
				}
				copy$2(tempPos, tempSum);
			} else {
				const group = geoset.Groups[geoset.VertexGroup[index]];
				for (let j = 0; j < group.length; ++j) add$2(tempSum, tempSum, transformMat4(tempVec3, tempPos, this.rendererData.nodes[group[j]].matrix));
				scale$2(tempPos, tempSum, 1 / group.length);
			}
			buffer[i] = tempPos[0];
			buffer[i + 1] = tempPos[1];
			buffer[i + 2] = tempPos[2];
		}
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[geosetIndex]);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, buffer, this.gl.DYNAMIC_DRAW);
	}
	setTextureParameters(flags, hasMipmaps) {
		if (flags & TextureFlags.WrapWidth) this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
		else this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
		if (flags & TextureFlags.WrapHeight) this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
		else this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, hasMipmaps ? this.gl.LINEAR_MIPMAP_NEAREST : this.gl.LINEAR);
		if (this.anisotropicExt) {
			const max = this.gl.getParameter(this.anisotropicExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
			this.gl.texParameterf(this.gl.TEXTURE_2D, this.anisotropicExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
		}
	}
	processEnvMaps(path) {
		if (!this.rendererData.requiredEnvMaps[path] || !(this.rendererData.textures[path] || this.rendererData.gpuTextures[path]) || !(isWebGL2(this.gl) || this.device) || !(this.colorBufferFloatExt || this.device)) return;
		if (this.gl) {
			this.gl.disable(this.gl.BLEND);
			this.gl.disable(this.gl.DEPTH_TEST);
			this.gl.disable(this.gl.CULL_FACE);
		}
		const pMatrix = create$3();
		const mvMatrix = create$3();
		const eye = fromValues$2(0, 0, 0);
		let center;
		let up;
		if (this.device) {
			center = [
				fromValues$2(1, 0, 0),
				fromValues$2(-1, 0, 0),
				fromValues$2(0, -1, 0),
				fromValues$2(0, 1, 0),
				fromValues$2(0, 0, 1),
				fromValues$2(0, 0, -1)
			];
			up = [
				fromValues$2(0, -1, 0),
				fromValues$2(0, -1, 0),
				fromValues$2(0, 0, -1),
				fromValues$2(0, 0, 1),
				fromValues$2(0, -1, 0),
				fromValues$2(0, -1, 0)
			];
		} else {
			center = [
				fromValues$2(1, 0, 0),
				fromValues$2(-1, 0, 0),
				fromValues$2(0, 1, 0),
				fromValues$2(0, -1, 0),
				fromValues$2(0, 0, 1),
				fromValues$2(0, 0, -1)
			];
			up = [
				fromValues$2(0, -1, 0),
				fromValues$2(0, -1, 0),
				fromValues$2(0, 0, 1),
				fromValues$2(0, 0, -1),
				fromValues$2(0, -1, 0),
				fromValues$2(0, -1, 0)
			];
		}
		perspective(pMatrix, Math.PI / 2, 1, .1, 10);
		let framebuffer;
		let cubemap;
		let gpuCubemap;
		if (this.device) {
			gpuCubemap = this.rendererData.gpuEnvTextures[path] = this.device.createTexture({
				label: `env cubemap ${path}`,
				size: [
					ENV_MAP_SIZE,
					ENV_MAP_SIZE,
					6
				],
				format: navigator.gpu.getPreferredCanvasFormat(),
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
				mipLevelCount: MAX_ENV_MIP_LEVELS
			});
			const encoder = this.device.createCommandEncoder({ label: "env to cubemap" });
			const buffers = [];
			for (let i = 0; i < 6; ++i) {
				lookAt(mvMatrix, eye, center[i], up[i]);
				const pass = encoder.beginRenderPass({
					label: "env to cubemap",
					colorAttachments: [{
						view: gpuCubemap.createView({
							dimension: "2d",
							baseArrayLayer: i,
							baseMipLevel: 0,
							mipLevelCount: 1
						}),
						clearValue: [
							0,
							0,
							0,
							1
						],
						loadOp: "clear",
						storeOp: "store"
					}]
				});
				const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
				const VSUniformsViews = {
					mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
					pMatrix: new Float32Array(VSUniformsValues, 64, 16)
				};
				VSUniformsViews.mvMatrix.set(mvMatrix);
				VSUniformsViews.pMatrix.set(pMatrix);
				const buffer = this.device.createBuffer({
					label: `env to cubemap vs uniforms ${i}`,
					size: 128,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				});
				buffers.push(buffer);
				this.device.queue.writeBuffer(buffer, 0, VSUniformsValues);
				const bindGroup = this.device.createBindGroup({
					label: `env to cubemap vs bind group ${i}`,
					layout: this.envToCubemapVSBindGroupLayout,
					entries: [{
						binding: 0,
						resource: { buffer }
					}]
				});
				pass.setBindGroup(0, bindGroup);
				const fsUniformsBindGroup = this.device.createBindGroup({
					label: `env to cubemap fs uniforms ${i}`,
					layout: this.envToCubemapFSBindGroupLayout,
					entries: [{
						binding: 0,
						resource: this.envToCubemapSampler
					}, {
						binding: 1,
						resource: this.rendererData.gpuTextures[path].createView()
					}]
				});
				pass.setBindGroup(1, fsUniformsBindGroup);
				pass.setPipeline(this.envToCubemapPiepeline);
				pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);
				pass.draw(36);
				pass.end();
			}
			const commandBuffer = encoder.finish();
			this.device.queue.submit([commandBuffer]);
			this.device.queue.onSubmittedWorkDone().finally(() => {
				buffers.forEach((buffer) => {
					buffer.destroy();
				});
			});
		} else if (isWebGL2(this.gl)) {
			framebuffer = this.gl.createFramebuffer();
			this.gl.useProgram(this.envToCubemap.program);
			cubemap = this.rendererData.envTextures[path] = this.gl.createTexture();
			this.gl.activeTexture(this.gl.TEXTURE1);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, cubemap);
			for (let i = 0; i < 6; ++i) this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.gl.RGBA16F, ENV_MAP_SIZE, ENV_MAP_SIZE, 0, this.gl.RGBA, this.gl.FLOAT, null);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
			this.gl.enableVertexAttribArray(this.envToCubemap.attributes.aPos);
			this.gl.vertexAttribPointer(this.envToCubemap.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
			this.gl.uniformMatrix4fv(this.envToCubemap.uniforms.uPMatrix, false, pMatrix);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);
			this.gl.uniform1i(this.envToCubemap.uniforms.uEquirectangularMap, 0);
			this.gl.viewport(0, 0, ENV_MAP_SIZE, ENV_MAP_SIZE);
			for (let i = 0; i < 6; ++i) {
				this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, cubemap, 0);
				this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
				lookAt(mvMatrix, eye, center[i], up[i]);
				this.gl.uniformMatrix4fv(this.envToCubemap.uniforms.uMVMatrix, false, mvMatrix);
				this.gl.drawArrays(this.gl.TRIANGLES, 0, 36);
			}
			this.gl.disableVertexAttribArray(this.envToCubemap.attributes.aPos);
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		}
		if (this.device) generateMips(this.device, gpuCubemap);
		else {
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, cubemap);
			this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
		}
		if (this.device) {
			gpuCubemap = this.rendererData.gpuIrradianceMap[path] = this.device.createTexture({
				label: `convolute diffuse ${path}`,
				size: [
					ENV_CONVOLUTE_DIFFUSE_SIZE,
					ENV_CONVOLUTE_DIFFUSE_SIZE,
					6
				],
				format: navigator.gpu.getPreferredCanvasFormat(),
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
				mipLevelCount: 5
			});
			const encoder = this.device.createCommandEncoder({ label: "convolute diffuse" });
			const buffers = [];
			for (let i = 0; i < 6; ++i) {
				lookAt(mvMatrix, eye, center[i], up[i]);
				const pass = encoder.beginRenderPass({
					label: "convolute diffuse",
					colorAttachments: [{
						view: gpuCubemap.createView({
							dimension: "2d",
							baseArrayLayer: i,
							baseMipLevel: 0,
							mipLevelCount: 1
						}),
						clearValue: [
							0,
							0,
							0,
							1
						],
						loadOp: "clear",
						storeOp: "store"
					}]
				});
				const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
				const VSUniformsViews = {
					mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
					pMatrix: new Float32Array(VSUniformsValues, 64, 16)
				};
				VSUniformsViews.mvMatrix.set(mvMatrix);
				VSUniformsViews.pMatrix.set(pMatrix);
				const buffer = this.device.createBuffer({
					label: `convolute diffuse vs uniforms ${i}`,
					size: 128,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				});
				buffers.push(buffer);
				this.device.queue.writeBuffer(buffer, 0, VSUniformsValues);
				const bindGroup = this.device.createBindGroup({
					label: `convolute diffuse vs bind group ${i}`,
					layout: this.convoluteDiffuseEnvVSBindGroupLayout,
					entries: [{
						binding: 0,
						resource: { buffer }
					}]
				});
				pass.setBindGroup(0, bindGroup);
				const fsUniformsBindGroup = this.device.createBindGroup({
					label: `convolute diffuse fs uniforms ${i}`,
					layout: this.convoluteDiffuseEnvFSBindGroupLayout,
					entries: [{
						binding: 0,
						resource: this.convoluteDiffuseEnvSampler
					}, {
						binding: 1,
						resource: this.rendererData.gpuEnvTextures[path].createView({ dimension: "cube" })
					}]
				});
				pass.setBindGroup(1, fsUniformsBindGroup);
				pass.setPipeline(this.convoluteDiffuseEnvPiepeline);
				pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);
				pass.draw(36);
				pass.end();
			}
			const commandBuffer = encoder.finish();
			this.device.queue.submit([commandBuffer]);
			this.device.queue.onSubmittedWorkDone().finally(() => {
				buffers.forEach((buffer) => {
					buffer.destroy();
				});
			});
		} else if (isWebGL2(this.gl)) {
			this.gl.useProgram(this.convoluteDiffuseEnv.program);
			const diffuseCubemap = this.rendererData.irradianceMap[path] = this.gl.createTexture();
			this.gl.activeTexture(this.gl.TEXTURE1);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, diffuseCubemap);
			for (let i = 0; i < 6; ++i) this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.gl.RGBA16F, ENV_CONVOLUTE_DIFFUSE_SIZE, ENV_CONVOLUTE_DIFFUSE_SIZE, 0, this.gl.RGBA, this.gl.FLOAT, null);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
			this.gl.enableVertexAttribArray(this.convoluteDiffuseEnv.attributes.aPos);
			this.gl.vertexAttribPointer(this.convoluteDiffuseEnv.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
			this.gl.uniformMatrix4fv(this.convoluteDiffuseEnv.uniforms.uPMatrix, false, pMatrix);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
			this.gl.uniform1i(this.convoluteDiffuseEnv.uniforms.uEnvironmentMap, 0);
			this.gl.viewport(0, 0, ENV_CONVOLUTE_DIFFUSE_SIZE, ENV_CONVOLUTE_DIFFUSE_SIZE);
			for (let i = 0; i < 6; ++i) {
				this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, diffuseCubemap, 0);
				this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
				lookAt(mvMatrix, eye, center[i], up[i]);
				this.gl.uniformMatrix4fv(this.convoluteDiffuseEnv.uniforms.uMVMatrix, false, mvMatrix);
				this.gl.drawArrays(this.gl.TRIANGLES, 0, 36);
			}
			this.gl.disableVertexAttribArray(this.convoluteDiffuseEnv.attributes.aPos);
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, diffuseCubemap);
			this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);
		}
		if (this.device) {
			const prefilterEnv = this.rendererData.gpuPrefilteredEnvMap[path] = this.device.createTexture({
				label: `prefilter env ${path}`,
				size: [
					ENV_PREFILTER_SIZE,
					ENV_PREFILTER_SIZE,
					6
				],
				format: navigator.gpu.getPreferredCanvasFormat(),
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
				mipLevelCount: MAX_ENV_MIP_LEVELS
			});
			const encoder = this.device.createCommandEncoder({ label: "prefilter env" });
			const buffers = [];
			for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) {
				const FSUniformsValues = /* @__PURE__ */ new ArrayBuffer(4);
				const FSUniformsViews = { roughness: new Float32Array(FSUniformsValues) };
				const roughness = mip / (MAX_ENV_MIP_LEVELS - 1);
				FSUniformsViews.roughness.set([roughness]);
				const fsBuffer = this.device.createBuffer({
					label: `prefilter env fs uniforms ${mip}`,
					size: 4,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				});
				buffers.push(fsBuffer);
				this.device.queue.writeBuffer(fsBuffer, 0, FSUniformsValues);
				const fsUniformsBindGroup = this.device.createBindGroup({
					label: `prefilter env fs uniforms ${mip}`,
					layout: this.prefilterEnvFSBindGroupLayout,
					entries: [
						{
							binding: 0,
							resource: { buffer: fsBuffer }
						},
						{
							binding: 1,
							resource: this.prefilterEnvSampler
						},
						{
							binding: 2,
							resource: this.rendererData.gpuEnvTextures[path].createView({ dimension: "cube" })
						}
					]
				});
				for (let i = 0; i < 6; ++i) {
					const pass = encoder.beginRenderPass({
						label: "prefilter env",
						colorAttachments: [{
							view: prefilterEnv.createView({
								dimension: "2d",
								baseArrayLayer: i,
								baseMipLevel: mip,
								mipLevelCount: 1
							}),
							clearValue: [
								0,
								0,
								0,
								1
							],
							loadOp: "clear",
							storeOp: "store"
						}]
					});
					lookAt(mvMatrix, eye, center[i], up[i]);
					const VSUniformsValues = /* @__PURE__ */ new ArrayBuffer(128);
					const VSUniformsViews = {
						mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
						pMatrix: new Float32Array(VSUniformsValues, 64, 16)
					};
					VSUniformsViews.mvMatrix.set(mvMatrix);
					VSUniformsViews.pMatrix.set(pMatrix);
					const vsBuffer = this.device.createBuffer({
						label: "prefilter env vs uniforms",
						size: 128,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
					});
					buffers.push(vsBuffer);
					this.device.queue.writeBuffer(vsBuffer, 0, VSUniformsValues);
					const fsBindGroup = this.device.createBindGroup({
						label: "prefilter env vs bind group",
						layout: this.prefilterEnvVSBindGroupLayout,
						entries: [{
							binding: 0,
							resource: { buffer: vsBuffer }
						}]
					});
					pass.setPipeline(this.prefilterEnvPiepeline);
					pass.setBindGroup(0, fsBindGroup);
					pass.setBindGroup(1, fsUniformsBindGroup);
					pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);
					pass.draw(36);
					pass.end();
				}
			}
			const commandBuffer = encoder.finish();
			this.device.queue.submit([commandBuffer]);
			this.device.queue.onSubmittedWorkDone().finally(() => {
				buffers.forEach((buffer) => {
					buffer.destroy();
				});
			});
		} else if (isWebGL2(this.gl)) {
			this.gl.useProgram(this.prefilterEnv.program);
			const prefilterCubemap = this.rendererData.prefilteredEnvMap[path] = this.gl.createTexture();
			this.gl.activeTexture(this.gl.TEXTURE1);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, prefilterCubemap);
			this.gl.texStorage2D(this.gl.TEXTURE_CUBE_MAP, MAX_ENV_MIP_LEVELS, this.gl.RGBA16F, ENV_PREFILTER_SIZE, ENV_PREFILTER_SIZE);
			for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) for (let i = 0; i < 6; ++i) {
				const size = ENV_PREFILTER_SIZE * .5 ** mip;
				const data = new Float32Array(size * size * 4);
				this.gl.texSubImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, mip, 0, 0, size, size, this.gl.RGBA, this.gl.FLOAT, data);
			}
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
			this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
			this.gl.enableVertexAttribArray(this.prefilterEnv.attributes.aPos);
			this.gl.vertexAttribPointer(this.prefilterEnv.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
			this.gl.uniformMatrix4fv(this.prefilterEnv.uniforms.uPMatrix, false, pMatrix);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
			this.gl.uniform1i(this.prefilterEnv.uniforms.uEnvironmentMap, 0);
			for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) {
				const mipWidth = ENV_PREFILTER_SIZE * .5 ** mip;
				const mipHeight = ENV_PREFILTER_SIZE * .5 ** mip;
				this.gl.viewport(0, 0, mipWidth, mipHeight);
				const roughness = mip / (MAX_ENV_MIP_LEVELS - 1);
				this.gl.uniform1f(this.prefilterEnv.uniforms.uRoughness, roughness);
				for (let i = 0; i < 6; ++i) {
					this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, prefilterCubemap, mip);
					this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
					lookAt(mvMatrix, eye, center[i], up[i]);
					this.gl.uniformMatrix4fv(this.prefilterEnv.uniforms.uMVMatrix, false, mvMatrix);
					this.gl.drawArrays(this.gl.TRIANGLES, 0, 36);
				}
			}
			this.gl.activeTexture(this.gl.TEXTURE1);
			this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
			this.gl.deleteFramebuffer(framebuffer);
		}
	}
	initShaderProgram(vertex, fragment, attributesDesc, uniformsDesc) {
		const vertexShader = getShader(this.gl, vertex, this.gl.VERTEX_SHADER);
		const fragmentShader = getShader(this.gl, fragment, this.gl.FRAGMENT_SHADER);
		const program = this.gl.createProgram();
		this.gl.attachShader(program, vertexShader);
		this.gl.attachShader(program, fragmentShader);
		this.gl.linkProgram(program);
		if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) throw new Error("Could not initialise shaders");
		const attributes = {};
		for (const name in attributesDesc) {
			attributes[name] = this.gl.getAttribLocation(program, name);
			if (attributes[name] < 0) throw new Error("Missing shader attribute location: " + name);
		}
		const uniforms = {};
		for (const name in uniformsDesc) {
			uniforms[name] = this.gl.getUniformLocation(program, name);
			if (!uniforms[name]) throw new Error("Missing shader uniform location: " + name);
		}
		return {
			program,
			vertexShader,
			fragmentShader,
			attributes,
			uniforms
		};
	}
	destroyShaderProgramObject(object) {
		if (object?.program) {
			if (object.vertexShader) {
				this.gl.detachShader(object.program, object.vertexShader);
				this.gl.deleteShader(object.vertexShader);
				object.vertexShader = null;
			}
			if (object.fragmentShader) {
				this.gl.detachShader(object.program, object.fragmentShader);
				this.gl.deleteShader(object.fragmentShader);
				object.fragmentShader = null;
			}
			this.gl.deleteProgram(object.program);
			object.program = null;
		}
	}
	initShaders() {
		if (this.shaderProgram) return;
		let vertexShaderSource;
		if (this.isHD) vertexShaderSource = isWebGL2(this.gl) ? vertexShaderHDHardwareSkinningNew : vertexShaderHDHardwareSkinningOld;
		else if (this.softwareSkinning) vertexShaderSource = sdSoftwareSkinning_vs_default;
		else vertexShaderSource = vertexShaderHardwareSkinning;
		let fragmentShaderSource;
		if (this.isHD) fragmentShaderSource = isWebGL2(this.gl) ? fragmentShaderHDNew : hdOld_fs_default;
		else fragmentShaderSource = sd_fs_default;
		const vertex = this.vertexShader = getShader(this.gl, vertexShaderSource, this.gl.VERTEX_SHADER);
		const fragment = this.fragmentShader = getShader(this.gl, fragmentShaderSource, this.gl.FRAGMENT_SHADER);
		const shaderProgram = this.shaderProgram = this.gl.createProgram();
		this.gl.attachShader(shaderProgram, vertex);
		this.gl.attachShader(shaderProgram, fragment);
		this.gl.linkProgram(shaderProgram);
		if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) alert("Could not initialise shaders");
		this.gl.useProgram(shaderProgram);
		this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, "aVertexPosition");
		this.shaderProgramLocations.normalsAttribute = this.gl.getAttribLocation(shaderProgram, "aNormal");
		this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(shaderProgram, "aTextureCoord");
		if (this.isHD) {
			this.shaderProgramLocations.skinAttribute = this.gl.getAttribLocation(shaderProgram, "aSkin");
			this.shaderProgramLocations.weightAttribute = this.gl.getAttribLocation(shaderProgram, "aBoneWeight");
			this.shaderProgramLocations.tangentAttribute = this.gl.getAttribLocation(shaderProgram, "aTangent");
		} else if (!this.softwareSkinning) this.shaderProgramLocations.groupAttribute = this.gl.getAttribLocation(shaderProgram, "aGroup");
		this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uPMatrix");
		this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uMVMatrix");
		this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, "uSampler");
		this.shaderProgramLocations.replaceableColorUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableColor");
		if (this.isHD) {
			this.shaderProgramLocations.normalSamplerUniform = this.gl.getUniformLocation(shaderProgram, "uNormalSampler");
			this.shaderProgramLocations.ormSamplerUniform = this.gl.getUniformLocation(shaderProgram, "uOrmSampler");
			this.shaderProgramLocations.lightPosUniform = this.gl.getUniformLocation(shaderProgram, "uLightPos");
			this.shaderProgramLocations.lightColorUniform = this.gl.getUniformLocation(shaderProgram, "uLightColor");
			this.shaderProgramLocations.cameraPosUniform = this.gl.getUniformLocation(shaderProgram, "uCameraPos");
			this.shaderProgramLocations.shadowParamsUniform = this.gl.getUniformLocation(shaderProgram, "uShadowParams");
			this.shaderProgramLocations.shadowMapSamplerUniform = this.gl.getUniformLocation(shaderProgram, "uShadowMapSampler");
			this.shaderProgramLocations.shadowMapLightMatrixUniform = this.gl.getUniformLocation(shaderProgram, "uShadowMapLightMatrix");
			this.shaderProgramLocations.hasEnvUniform = this.gl.getUniformLocation(shaderProgram, "uHasEnv");
			this.shaderProgramLocations.irradianceMapUniform = this.gl.getUniformLocation(shaderProgram, "uIrradianceMap");
			this.shaderProgramLocations.prefilteredEnvUniform = this.gl.getUniformLocation(shaderProgram, "uPrefilteredEnv");
			this.shaderProgramLocations.brdfLUTUniform = this.gl.getUniformLocation(shaderProgram, "uBRDFLUT");
		} else this.shaderProgramLocations.replaceableTypeUniform = this.gl.getUniformLocation(shaderProgram, "uReplaceableType");
		this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(shaderProgram, "uDiscardAlphaLevel");
		this.shaderProgramLocations.layerAlphaUniform = this.gl.getUniformLocation(shaderProgram, "uLayerAlpha");
		this.shaderProgramLocations.tVertexAnimUniform = this.gl.getUniformLocation(shaderProgram, "uTVertexAnim");
		this.shaderProgramLocations.wireframeUniform = this.gl.getUniformLocation(shaderProgram, "uWireframe");
		this.shaderProgramLocations.wisp = Object.fromEntries(["uWispLight", "uWispKey", "uWispAmbient", "uWispFog", "uWispFogRange", "uWispFogMax", "uWispLayer", "uWispGeosetColor", "uWispPointCount", "uWispPointPos", "uWispPointColor", "uWispPointRange", "uWispModel", "uWispNormal", "uWispShadowMap", "uWispShadowMatrix", "uWispShadow", "uWispPointShadowMap", "uWispPointShadowMatrix", "uWispPointCaster", "uWispPointCasterPos", "uWispPointShadow"].map((name) => [name, this.gl.getUniformLocation(shaderProgram, name)]));
		if (!this.softwareSkinning) {
			this.shaderProgramLocations.nodesMatricesAttributes = [];
			for (let i = 0; i < MAX_NODES; ++i) this.shaderProgramLocations.nodesMatricesAttributes[i] = this.gl.getUniformLocation(shaderProgram, `uNodesMatrices[${i}]`);
		}
		if (this.isHD && isWebGL2(this.gl)) {
			this.envToCubemap = this.initShaderProgram(envToCubemap_vs_default, envToCubemap_fs_default, { aPos: "aPos" }, {
				uPMatrix: "uPMatrix",
				uMVMatrix: "uMVMatrix",
				uEquirectangularMap: "uEquirectangularMap"
			});
			this.envSphere = this.initShaderProgram(env_vs_default, env_fs_default, { aPos: "aPos" }, {
				uPMatrix: "uPMatrix",
				uMVMatrix: "uMVMatrix",
				uEnvironmentMap: "uEnvironmentMap"
			});
			this.convoluteDiffuseEnv = this.initShaderProgram(convoluteEnvDiffuse_vs_default, convoluteEnvDiffuse_fs_default, { aPos: "aPos" }, {
				uPMatrix: "uPMatrix",
				uMVMatrix: "uMVMatrix",
				uEnvironmentMap: "uEnvironmentMap"
			});
			this.prefilterEnv = this.initShaderProgram(prefilterEnv_vs_default, prefilterEnv_fs_default, { aPos: "aPos" }, {
				uPMatrix: "uPMatrix",
				uMVMatrix: "uMVMatrix",
				uEnvironmentMap: "uEnvironmentMap",
				uRoughness: "uRoughness"
			});
			this.integrateBRDF = this.initShaderProgram(integrateBRDF_vs_default, integrateBRDF_fs_default, { aPos: "aPos" }, {});
		}
	}
	initGPUShaders() {
		if (this.gpuShaderModule) return;
		this.gpuShaderModule = this.device.createShaderModule({
			label: "main",
			code: this.isHD ? hdShader : sdShader
		});
		this.gpuDepthShaderModule = this.device.createShaderModule({
			label: "depth",
			code: depthShader
		});
		for (let i = 0; i < this.model.Textures.length; ++i) {
			const flags = this.model.Textures[i].Flags;
			const addressModeU = flags & TextureFlags.WrapWidth ? "repeat" : "clamp-to-edge";
			const addressModeV = flags & TextureFlags.WrapHeight ? "repeat" : "clamp-to-edge";
			this.rendererData.gpuSamplers[i] = this.device.createSampler({
				label: `texture sampler ${i}`,
				minFilter: "linear",
				magFilter: "linear",
				mipmapFilter: "linear",
				maxAnisotropy: 16,
				addressModeU,
				addressModeV
			});
		}
		this.rendererData.gpuDepthSampler = this.device.createSampler({
			label: "texture depth sampler",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
			compare: "less",
			minFilter: "nearest",
			magFilter: "nearest"
		});
		if (this.isHD) {
			this.envShaderModeule = this.device.createShaderModule({
				label: "env",
				code: env_default
			});
			this.envPiepeline = this.device.createRenderPipeline({
				label: "env",
				layout: "auto",
				vertex: {
					module: this.envShaderModeule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}]
				},
				fragment: {
					module: this.envShaderModeule,
					targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
				},
				depthStencil: {
					depthWriteEnabled: false,
					depthCompare: "always",
					format: "depth24plus"
				},
				multisample: { count: MULTISAMPLE }
			});
			this.envVSUniformsBuffer = this.device.createBuffer({
				label: "env vs uniforms",
				size: 128,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.envVSBindGroupLayout = this.envPiepeline.getBindGroupLayout(0);
			this.envVSBindGroup = this.device.createBindGroup({
				label: "env vs bind group",
				layout: this.envVSBindGroupLayout,
				entries: [{
					binding: 0,
					resource: { buffer: this.envVSUniformsBuffer }
				}]
			});
			this.envSampler = this.device.createSampler({
				label: "env cube sampler",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge",
				addressModeW: "clamp-to-edge",
				minFilter: "linear",
				magFilter: "linear"
			});
			this.envFSBindGroupLayout = this.envPiepeline.getBindGroupLayout(1);
			this.envToCubemapShaderModule = this.device.createShaderModule({
				label: "env to cubemap",
				code: envToCubemap_default
			});
			this.envToCubemapPiepeline = this.device.createRenderPipeline({
				label: "env to cubemap",
				layout: "auto",
				vertex: {
					module: this.envToCubemapShaderModule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}]
				},
				fragment: {
					module: this.envToCubemapShaderModule,
					targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
				}
			});
			this.envToCubemapVSBindGroupLayout = this.envToCubemapPiepeline.getBindGroupLayout(0);
			this.envToCubemapSampler = this.device.createSampler({
				label: "env to cubemap sampler",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge",
				minFilter: "linear",
				magFilter: "linear"
			});
			this.envToCubemapFSBindGroupLayout = this.envToCubemapPiepeline.getBindGroupLayout(1);
			this.convoluteDiffuseEnvShaderModule = this.device.createShaderModule({
				label: "convolute diffuse",
				code: convoluteEnvDiffuse_default
			});
			this.convoluteDiffuseEnvPiepeline = this.device.createRenderPipeline({
				label: "convolute diffuse",
				layout: "auto",
				vertex: {
					module: this.convoluteDiffuseEnvShaderModule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}]
				},
				fragment: {
					module: this.convoluteDiffuseEnvShaderModule,
					targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
				}
			});
			this.convoluteDiffuseEnvVSBindGroupLayout = this.convoluteDiffuseEnvPiepeline.getBindGroupLayout(0);
			this.convoluteDiffuseEnvFSBindGroupLayout = this.convoluteDiffuseEnvPiepeline.getBindGroupLayout(1);
			this.convoluteDiffuseEnvSampler = this.device.createSampler({
				label: "convolute diffuse",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge",
				minFilter: "linear",
				magFilter: "linear"
			});
			this.prefilterEnvShaderModule = this.device.createShaderModule({
				label: "prefilter env",
				code: prefilterEnv_default
			});
			this.prefilterEnvPiepeline = this.device.createRenderPipeline({
				label: "prefilter env",
				layout: "auto",
				vertex: {
					module: this.prefilterEnvShaderModule,
					buffers: [{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					}]
				},
				fragment: {
					module: this.prefilterEnvShaderModule,
					targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
				}
			});
			this.prefilterEnvVSBindGroupLayout = this.prefilterEnvPiepeline.getBindGroupLayout(0);
			this.prefilterEnvFSBindGroupLayout = this.prefilterEnvPiepeline.getBindGroupLayout(1);
			this.prefilterEnvSampler = this.device.createSampler({
				label: "prefilter env",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge",
				addressModeW: "clamp-to-edge",
				minFilter: "linear",
				magFilter: "linear"
			});
		}
	}
	createWireframeBuffer(index) {
		const faces = this.model.Geosets[index].Faces;
		const lines = new Uint16Array(faces.length * 2);
		for (let i = 0; i < faces.length; i += 3) {
			lines[i * 2] = faces[i];
			lines[i * 2 + 1] = faces[i + 1];
			lines[i * 2 + 2] = faces[i + 1];
			lines[i * 2 + 3] = faces[i + 2];
			lines[i * 2 + 4] = faces[i + 2];
			lines[i * 2 + 5] = faces[i];
		}
		this.wireframeIndexBuffer[index] = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.wireframeIndexBuffer[index]);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, lines, this.gl.STATIC_DRAW);
	}
	createWireframeGPUBuffer(index) {
		const faces = this.model.Geosets[index].Faces;
		const lines = new Uint16Array(faces.length * 2);
		for (let i = 0; i < faces.length; i += 3) {
			lines[i * 2] = faces[i];
			lines[i * 2 + 1] = faces[i + 1];
			lines[i * 2 + 2] = faces[i + 1];
			lines[i * 2 + 3] = faces[i + 2];
			lines[i * 2 + 4] = faces[i + 2];
			lines[i * 2 + 5] = faces[i];
		}
		this.wireframeIndexGPUBuffer[index] = this.device.createBuffer({
			label: `wireframe ${index}`,
			size: lines.byteLength,
			usage: GPUBufferUsage.INDEX,
			mappedAtCreation: true
		});
		new Uint16Array(this.wireframeIndexGPUBuffer[index].getMappedRange(0, this.wireframeIndexGPUBuffer[index].size)).set(lines);
		this.wireframeIndexGPUBuffer[index].unmap();
	}
	initBuffers() {
		for (let i = 0; i < this.model.Geosets.length; ++i) {
			const geoset = this.model.Geosets[i];
			this.vertexBuffer[i] = this.gl.createBuffer();
			if (this.softwareSkinning) this.vertices[i] = new Float32Array(geoset.Vertices.length);
			else {
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, geoset.Vertices, this.gl.STATIC_DRAW);
			}
			this.normalBuffer[i] = this.gl.createBuffer();
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, geoset.Normals, this.gl.STATIC_DRAW);
			this.texCoordBuffer[i] = this.gl.createBuffer();
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, geoset.TVertices[0], this.gl.STATIC_DRAW);
			if (this.isHD) {
				this.skinWeightBuffer[i] = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skinWeightBuffer[i]);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, geoset.SkinWeights, this.gl.STATIC_DRAW);
				this.tangentBuffer[i] = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.tangentBuffer[i]);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, geoset.Tangents, this.gl.STATIC_DRAW);
			} else if (!this.softwareSkinning) {
				this.groupBuffer[i] = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
				const buffer = new Uint16Array(geoset.VertexGroup.length * 4);
				for (let j = 0; j < buffer.length; j += 4) {
					const index = j / 4;
					const group = geoset.Groups[geoset.VertexGroup[index]];
					buffer[j] = group[0];
					buffer[j + 1] = group.length > 1 ? group[1] : MAX_NODES;
					buffer[j + 2] = group.length > 2 ? group[2] : MAX_NODES;
					buffer[j + 3] = group.length > 3 ? group[3] : MAX_NODES;
				}
				this.gl.bufferData(this.gl.ARRAY_BUFFER, buffer, this.gl.STATIC_DRAW);
			}
			this.indexBuffer[i] = this.gl.createBuffer();
			this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer[i]);
			this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, geoset.Faces, this.gl.STATIC_DRAW);
		}
	}
	createGPUPipeline(name, blend, depth, shaderModule = this.gpuShaderModule, extra = {}) {
		return this.device.createRenderPipeline({
			label: `pipeline ${name}`,
			layout: this.gpuPipelineLayout,
			vertex: {
				module: shaderModule,
				buffers: [
					{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 0,
							offset: 0,
							format: "float32x3"
						}]
					},
					{
						arrayStride: 12,
						attributes: [{
							shaderLocation: 1,
							offset: 0,
							format: "float32x3"
						}]
					},
					{
						arrayStride: 8,
						attributes: [{
							shaderLocation: 2,
							offset: 0,
							format: "float32x2"
						}]
					},
					...this.isHD ? [
						{
							arrayStride: 16,
							attributes: [{
								shaderLocation: 3,
								offset: 0,
								format: "float32x4"
							}]
						},
						{
							arrayStride: 8,
							attributes: [{
								shaderLocation: 4,
								offset: 0,
								format: "uint8x4"
							}]
						},
						{
							arrayStride: 8,
							attributes: [{
								shaderLocation: 5,
								offset: 4,
								format: "unorm8x4"
							}]
						}
					] : [{
						arrayStride: 4,
						attributes: [{
							shaderLocation: 3,
							offset: 0,
							format: "uint8x4"
						}]
					}]
				]
			},
			fragment: {
				module: shaderModule,
				targets: [{
					format: navigator.gpu.getPreferredCanvasFormat(),
					blend
				}]
			},
			depthStencil: depth,
			multisample: { count: MULTISAMPLE },
			...extra
		});
	}
	createGPUPipelineByLayer(filterMode, twoSided) {
		return this.createGPUPipeline(...GPU_LAYER_PROPS[filterMode], void 0, { primitive: { cullMode: twoSided ? "none" : "back" } });
	}
	getGPUPipeline(layer) {
		const filterMode = layer.FilterMode || 0;
		const twoSided = Boolean((layer.Shading || 0) & LayerShading.TwoSided);
		const key = `${filterMode}-${twoSided}`;
		if (!this.gpuPipelines[key]) this.gpuPipelines[key] = this.createGPUPipelineByLayer(filterMode, twoSided);
		return this.gpuPipelines[key];
	}
	initGPUPipeline() {
		this.vsBindGroupLayout = this.device.createBindGroupLayout({
			label: "vs bind group layout",
			entries: [{
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: {
					type: "uniform",
					hasDynamicOffset: false,
					minBindingSize: 128 + 64 * MAX_NODES
				}
			}]
		});
		this.fsBindGroupLayout = this.device.createBindGroupLayout({
			label: "fs bind group layout2",
			entries: this.isHD ? [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {
						type: "uniform",
						hasDynamicOffset: false,
						minBindingSize: 192
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				},
				{
					binding: 3,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 4,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				},
				{
					binding: 5,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 6,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				},
				{
					binding: 7,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "comparison" }
				},
				{
					binding: 8,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "depth",
						viewDimension: "2d",
						multisampled: false
					}
				},
				{
					binding: 9,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 10,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "cube",
						multisampled: false
					}
				},
				{
					binding: 11,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 12,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "cube",
						multisampled: false
					}
				},
				{
					binding: 13,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 14,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				}
			] : [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {
						type: "uniform",
						hasDynamicOffset: false,
						minBindingSize: 80
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "float",
						viewDimension: "2d",
						multisampled: false
					}
				}
			]
		});
		this.gpuPipelineLayout = this.device.createPipelineLayout({
			label: "pipeline layout",
			bindGroupLayouts: [this.vsBindGroupLayout, this.fsBindGroupLayout]
		});
		this.gpuWireframePipeline = this.createGPUPipeline("wireframe", {
			color: {
				operation: "add",
				srcFactor: "src-alpha",
				dstFactor: "one-minus-src-alpha"
			},
			alpha: {
				operation: "add",
				srcFactor: "one",
				dstFactor: "one-minus-src-alpha"
			}
		}, {
			depthWriteEnabled: true,
			depthCompare: "less-equal",
			format: "depth24plus"
		}, void 0, { primitive: { topology: "line-list" } });
		if (this.isHD) this.gpuShadowPipeline = this.createGPUPipeline("shadow", void 0, {
			depthWriteEnabled: true,
			depthCompare: "less-equal",
			format: "depth32float"
		}, this.gpuDepthShaderModule, {
			fragment: {
				module: this.gpuDepthShaderModule,
				targets: []
			},
			multisample: { count: 1 }
		});
		this.gpuRenderPassDescriptor = {
			label: "basic renderPass",
			colorAttachments: [{
				view: null,
				clearValue: [
					.15,
					.15,
					.15,
					1
				],
				loadOp: "clear",
				storeOp: "store"
			}]
		};
	}
	initGPUBuffers() {
		for (let i = 0; i < this.model.Geosets.length; ++i) {
			const geoset = this.model.Geosets[i];
			this.gpuVertexBuffer[i] = this.device.createBuffer({
				label: `vertex ${i}`,
				size: geoset.Vertices.byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(this.gpuVertexBuffer[i].getMappedRange(0, this.gpuVertexBuffer[i].size)).set(geoset.Vertices);
			this.gpuVertexBuffer[i].unmap();
			this.gpuNormalBuffer[i] = this.device.createBuffer({
				label: `normal ${i}`,
				size: geoset.Normals.byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(this.gpuNormalBuffer[i].getMappedRange(0, this.gpuNormalBuffer[i].size)).set(geoset.Normals);
			this.gpuNormalBuffer[i].unmap();
			this.gpuTexCoordBuffer[i] = this.device.createBuffer({
				label: `texCoord ${i}`,
				size: geoset.TVertices[0].byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(this.gpuTexCoordBuffer[i].getMappedRange(0, this.gpuTexCoordBuffer[i].size)).set(geoset.TVertices[0]);
			this.gpuTexCoordBuffer[i].unmap();
			if (this.isHD) {
				this.gpuSkinWeightBuffer[i] = this.device.createBuffer({
					label: `SkinWeight ${i}`,
					size: geoset.SkinWeights.byteLength,
					usage: GPUBufferUsage.VERTEX,
					mappedAtCreation: true
				});
				new Uint8Array(this.gpuSkinWeightBuffer[i].getMappedRange(0, this.gpuSkinWeightBuffer[i].size)).set(geoset.SkinWeights);
				this.gpuSkinWeightBuffer[i].unmap();
				this.gpuTangentBuffer[i] = this.device.createBuffer({
					label: `Tangents ${i}`,
					size: geoset.Tangents.byteLength,
					usage: GPUBufferUsage.VERTEX,
					mappedAtCreation: true
				});
				new Float32Array(this.gpuTangentBuffer[i].getMappedRange(0, this.gpuTangentBuffer[i].size)).set(geoset.Tangents);
				this.gpuTangentBuffer[i].unmap();
			} else {
				const buffer = new Uint8Array(geoset.VertexGroup.length * 4);
				for (let j = 0; j < buffer.length; j += 4) {
					const index = j / 4;
					const group = geoset.Groups[geoset.VertexGroup[index]];
					buffer[j] = group[0];
					buffer[j + 1] = group.length > 1 ? group[1] : MAX_NODES;
					buffer[j + 2] = group.length > 2 ? group[2] : MAX_NODES;
					buffer[j + 3] = group.length > 3 ? group[3] : MAX_NODES;
				}
				this.gpuGroupBuffer[i] = this.device.createBuffer({
					label: `group ${i}`,
					size: 4 * geoset.VertexGroup.length,
					usage: GPUBufferUsage.VERTEX,
					mappedAtCreation: true
				});
				new Uint8Array(this.gpuGroupBuffer[i].getMappedRange(0, this.gpuGroupBuffer[i].size)).set(buffer);
				this.gpuGroupBuffer[i].unmap();
			}
			const size = Math.ceil(geoset.Faces.byteLength / 4) * 4;
			this.gpuIndexBuffer[i] = this.device.createBuffer({
				label: `index ${i}`,
				size: 2 * size,
				usage: GPUBufferUsage.INDEX,
				mappedAtCreation: true
			});
			new Uint16Array(this.gpuIndexBuffer[i].getMappedRange(0, size)).set(geoset.Faces);
			this.gpuIndexBuffer[i].unmap();
		}
	}
	initGPUUniformBuffers() {
		this.gpuVSUniformsBuffer = this.device.createBuffer({
			label: "vs uniforms",
			size: 128 + 64 * MAX_NODES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		this.gpuVSUniformsBindGroup = this.device.createBindGroup({
			label: "vs uniforms bind group",
			layout: this.vsBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: this.gpuVSUniformsBuffer }
			}]
		});
	}
	initGPUMultisampleTexture() {
		this.gpuMultisampleTexture = this.device.createTexture({
			label: "multisample texutre",
			size: [this.canvas.width, this.canvas.height],
			format: navigator.gpu.getPreferredCanvasFormat(),
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
			sampleCount: MULTISAMPLE
		});
	}
	initGPUDepthTexture() {
		this.gpuDepthTexture = this.device.createTexture({
			label: "depth texture",
			size: [this.canvas.width, this.canvas.height],
			format: "depth24plus",
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
			sampleCount: MULTISAMPLE
		});
	}
	initGPUEmptyTexture() {
		const texture = this.rendererData.gpuEmptyTexture = this.device.createTexture({
			label: "empty texture",
			size: [1, 1],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
		this.device.queue.writeTexture({ texture }, new Uint8Array([
			255,
			255,
			255,
			255
		]), { bytesPerRow: 4 }, {
			width: 1,
			height: 1
		});
		this.rendererData.gpuEmptyCubeTexture = this.device.createTexture({
			label: "empty cube texture",
			size: [
				1,
				1,
				6
			],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
		this.rendererData.gpuDepthEmptyTexture = this.device.createTexture({
			label: "empty depth texture",
			size: [1, 1],
			format: "depth32float",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
	}
	initCube() {
		const data = new Float32Array([
			-.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			-.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			.5,
			.5,
			-.5,
			.5,
			.5,
			.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			.5,
			.5,
			.5,
			.5,
			-.5,
			-.5,
			.5,
			.5,
			.5,
			.5,
			.5,
			.5,
			.5,
			-.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			-.5,
			.5,
			.5,
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			-.5,
			.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			-.5,
			.5,
			-.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			-.5,
			.5,
			.5,
			-.5,
			.5,
			.5,
			.5,
			-.5,
			.5,
			.5,
			.5
		]);
		if (this.device) {
			const vertex = this.cubeGPUVertexBuffer = this.device.createBuffer({
				label: "skeleton vertex",
				size: data.byteLength,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true
			});
			new Float32Array(vertex.getMappedRange(0, vertex.size)).set(data);
			vertex.unmap();
		} else {
			this.cubeVertexBuffer = this.gl.createBuffer();
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
		}
	}
	initSquare() {
		this.squareVertexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			1,
			-1,
			1,
			1,
			-1,
			1
		]), this.gl.STATIC_DRAW);
	}
	initBRDFLUT() {
		if (!isWebGL2(this.gl) || !this.isHD || !this.colorBufferFloatExt) return;
		this.brdfLUT = this.gl.createTexture();
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.brdfLUT);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RG16F, BRDF_LUT_SIZE, BRDF_LUT_SIZE, 0, this.gl.RG, this.gl.FLOAT, null);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
		const framebuffer = this.gl.createFramebuffer();
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
		this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.brdfLUT, 0);
		this.gl.useProgram(this.integrateBRDF.program);
		this.gl.viewport(0, 0, BRDF_LUT_SIZE, BRDF_LUT_SIZE);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexBuffer);
		this.gl.enableVertexAttribArray(this.integrateBRDF.attributes.aPos);
		this.gl.vertexAttribPointer(this.integrateBRDF.attributes.aPos, 2, this.gl.FLOAT, false, 0, 0);
		this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		this.gl.deleteFramebuffer(framebuffer);
	}
	initGPUBRDFLUT() {
		const shaderModule = this.device.createShaderModule({
			label: "integrate brdf",
			code: integrateBRDF_default
		});
		this.gpuBrdfLUT = this.device.createTexture({
			label: "brdf",
			size: [BRDF_LUT_SIZE, BRDF_LUT_SIZE],
			format: "rg16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
		});
		const square = new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			1,
			-1,
			1,
			1,
			-1,
			1
		]);
		const buffer = this.device.createBuffer({
			label: "brdf square",
			size: square.byteLength,
			usage: GPUBufferUsage.VERTEX,
			mappedAtCreation: true
		});
		new Float32Array(buffer.getMappedRange(0, buffer.size)).set(square);
		buffer.unmap();
		const encoder = this.device.createCommandEncoder({ label: "integrate brdf" });
		const pass = encoder.beginRenderPass({
			label: "integrate brdf",
			colorAttachments: [{
				view: this.gpuBrdfLUT.createView(),
				clearValue: [
					0,
					0,
					0,
					1
				],
				loadOp: "clear",
				storeOp: "store"
			}]
		});
		pass.setPipeline(this.device.createRenderPipeline({
			label: "integrate brdf",
			layout: "auto",
			vertex: {
				module: shaderModule,
				buffers: [{
					arrayStride: 8,
					attributes: [{
						shaderLocation: 0,
						offset: 0,
						format: "float32x2"
					}]
				}]
			},
			fragment: {
				module: shaderModule,
				targets: [{ format: "rg16float" }]
			}
		}));
		pass.setVertexBuffer(0, buffer);
		pass.draw(6);
		pass.end();
		const commandBuffer = encoder.finish();
		this.device.queue.submit([commandBuffer]);
		this.device.queue.onSubmittedWorkDone().finally(() => {
			buffer.destroy();
		});
		this.gpuBrdfSampler = this.device.createSampler({
			label: "brdf lut",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
			minFilter: "linear",
			magFilter: "linear"
		});
	}
	updateGlobalSequences(delta) {
		for (let i = 0; i < this.rendererData.globalSequencesFrames.length; ++i) {
			this.rendererData.globalSequencesFrames[i] += delta;
			if (this.rendererData.globalSequencesFrames[i] > this.model.GlobalSequences[i]) this.rendererData.globalSequencesFrames[i] = 0;
		}
	}
	updateNode(node) {
		const translationRes = this.interp.vec3(translation, node.node.Translation);
		const rotationRes = this.interp.quat(rotation, node.node.Rotation);
		const scalingRes = this.interp.vec3(scaling, node.node.Scaling);
		if (!translationRes && !rotationRes && !scalingRes) identity(node.matrix);
		else if (translationRes && !rotationRes && !scalingRes) fromTranslation(node.matrix, translationRes);
		else if (!translationRes && rotationRes && !scalingRes) mat4fromRotationOrigin(node.matrix, rotationRes, node.node.PivotPoint);
		else fromRotationTranslationScaleOrigin(node.matrix, rotationRes || defaultRotation, translationRes || defaultTranslation, scalingRes || defaultScaling, node.node.PivotPoint);
		if (node.node.Parent || node.node.Parent === 0) mul(node.matrix, this.rendererData.nodes[node.node.Parent].matrix, node.matrix);
		const billboardedLock = node.node.Flags & NodeFlags.BillboardedLockX || node.node.Flags & NodeFlags.BillboardedLockY || node.node.Flags & NodeFlags.BillboardedLockZ;
		if (node.node.Flags & NodeFlags.Billboarded) {
			transformMat4(tempTransformedPivotPoint, node.node.PivotPoint, node.matrix);
			if (node.node.Parent || node.node.Parent === 0) {
				getRotation(tempParentRotationQuat, this.rendererData.nodes[node.node.Parent].matrix);
				invert(tempParentRotationQuat, tempParentRotationQuat);
				mat4fromRotationOrigin(tempParentRotationMat, tempParentRotationQuat, tempTransformedPivotPoint);
				mul(node.matrix, tempParentRotationMat, node.matrix);
			}
			mat4fromRotationOrigin(tempCameraMat, this.rendererData.cameraQuat, tempTransformedPivotPoint);
			mul(node.matrix, tempCameraMat, node.matrix);
		} else if (billboardedLock) {
			transformMat4(tempTransformedPivotPoint, node.node.PivotPoint, node.matrix);
			copy$2(tempAxis, node.node.PivotPoint);
			if (node.node.Flags & NodeFlags.BillboardedLockX) tempAxis[0] += 1;
			else if (node.node.Flags & NodeFlags.BillboardedLockY) tempAxis[1] += 1;
			else if (node.node.Flags & NodeFlags.BillboardedLockZ) tempAxis[2] += 1;
			transformMat4(tempAxis, tempAxis, node.matrix);
			sub(tempAxis, tempAxis, tempTransformedPivotPoint);
			set$2(tempXAxis, 1, 0, 0);
			add$2(tempXAxis, tempXAxis, node.node.PivotPoint);
			transformMat4(tempXAxis, tempXAxis, node.matrix);
			sub(tempXAxis, tempXAxis, tempTransformedPivotPoint);
			set$2(tempCameraVec, -1, 0, 0);
			transformQuat(tempCameraVec, tempCameraVec, this.rendererData.cameraQuat);
			cross(tempCross0, tempAxis, tempCameraVec);
			cross(tempCross1, tempAxis, tempCross0);
			normalize$2(tempCross1, tempCross1);
			rotationTo(tempLockQuat, tempXAxis, tempCross1);
			mat4fromRotationOrigin(tempLockMat, tempLockQuat, tempTransformedPivotPoint);
			mul(node.matrix, tempLockMat, node.matrix);
		}
		for (const child of node.childs) this.updateNode(child);
	}
	/** Wisp: a geoset's animated colour in the order the file stores it, white without a geoset animation. Native Classic draws the stored order as red, green, blue, whatever the animation's flags say. */
	findColor(geosetId) {
		const geosetAnim = this.rendererData.geosetAnims[geosetId];
		if (!geosetAnim || geosetAnim.Color === void 0) return wispWhite;
		if (geosetAnim.Color instanceof Float32Array) return geosetAnim.Color;
		return this.interp.vec3(wispGeosetColor, geosetAnim.Color) ?? wispWhite;
	}
	findAlpha(geosetId) {
		const geosetAnim = this.rendererData.geosetAnims[geosetId];
		if (!geosetAnim || geosetAnim.Alpha === void 0) return 1;
		if (typeof geosetAnim.Alpha === "number") return geosetAnim.Alpha;
		const interpRes = this.interp.num(geosetAnim.Alpha);
		if (interpRes === null) return 1;
		return interpRes;
	}
	getTexCoordMatrix(layer) {
		if (typeof layer.TVertexAnimId === "number") {
			const anim = this.rendererData.model.TextureAnims[layer.TVertexAnimId];
			const translationRes = this.interp.vec3(translation, anim.Translation);
			const rotationRes = this.interp.quat(rotation, anim.Rotation);
			const scalingRes = this.interp.vec3(scaling, anim.Scaling);
			fromRotationTranslationScale(texCoordMat4, rotationRes || defaultRotation, translationRes || defaultTranslation, scalingRes || defaultScaling);
			set$3(texCoordMat3, texCoordMat4[0], texCoordMat4[1], 0, texCoordMat4[4], texCoordMat4[5], 0, texCoordMat4[12], texCoordMat4[13], 0);
			return texCoordMat3;
		} else return identifyMat3;
	}
	/** A layer's opacity is its geoset's animated alpha times the layer's own animated alpha. */
	setLayerAlpha(geoset, layer) {
		const alpha = typeof layer.Alpha === "number" ? layer.Alpha : layer.Alpha === void 0 ? 1 : this.interp.num(layer.Alpha) ?? 1;
		this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, layerOpacity(this.rendererData.geosetAlpha[geoset], alpha, this.instanceAlpha));
		const wisp = this.shaderProgramLocations.wisp;
		if (wisp !== void 0) {
			const color = this.findColor(geoset);
			this.gl.uniform3f(wisp.uWispGeosetColor, color[0] * this.instanceColor[0], color[1] * this.instanceColor[1], color[2] * this.instanceColor[2]);
		}
	}
	/** The whole model's opacity, as a game sets an effect's alpha. Particles and ribbons ignore it. */
	setInstanceAlpha(alpha) {
		this.instanceAlpha = alpha;
	}
	/** The whole model's vertex RGB tint. Particles and ribbons keep their emitter colours. */
	setInstanceColor(color) {
		this.instanceColor.set(color);
	}
	setLayerProps(layer, textureID) {
		const texture = this.model.Textures[textureID];
		this.setWispLayer(layer);
		if (layer.Shading & LayerShading.TwoSided) this.gl.disable(this.gl.CULL_FACE);
		else this.gl.enable(this.gl.CULL_FACE);
		if (layer.FilterMode === FilterMode.Transparent) this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, .75);
		else this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
		const factors = layerBlendFactors(layer.FilterMode) ?? [
			1,
			0,
			1,
			0
		];
		if (layer.FilterMode === FilterMode.None) {
			this.gl.disable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.depthMask(true);
		} else if (layer.FilterMode === FilterMode.Transparent) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(true);
		} else if (layer.FilterMode === FilterMode.Blend) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Additive) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.AddAlpha) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Modulate) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (layer.FilterMode === FilterMode.Modulate2x) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		}
		if (texture.Image) {
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texture.Image]);
			this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
		} else if (texture.ReplaceableId === 1 || texture.ReplaceableId === 2) {
			this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
			this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
		}
		if (layer.Shading & LayerShading.NoDepthTest) this.gl.disable(this.gl.DEPTH_TEST);
		if (layer.Shading & LayerShading.NoDepthSet) this.gl.depthMask(false);
		this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, this.getTexCoordMatrix(layer));
	}
	setLayerPropsHD(materialID, layers) {
		const baseLayer = layers[0];
		const textures = this.rendererData.materialLayerTextureID[materialID];
		const normalTextres = this.rendererData.materialLayerNormalTextureID[materialID];
		const ormTextres = this.rendererData.materialLayerOrmTextureID[materialID];
		const diffuseTextureID = textures[0];
		const diffuseTexture = this.model.Textures[diffuseTextureID];
		const normalTextureID = baseLayer?.ShaderTypeId === 1 ? normalTextres[0] : textures[1];
		const normalTexture = this.model.Textures[normalTextureID];
		const ormTextureID = baseLayer?.ShaderTypeId === 1 ? ormTextres[0] : textures[2];
		const ormTexture = this.model.Textures[ormTextureID];
		this.setWispLayer(baseLayer);
		if (baseLayer.Shading & LayerShading.TwoSided) this.gl.disable(this.gl.CULL_FACE);
		else this.gl.enable(this.gl.CULL_FACE);
		if (baseLayer.FilterMode === FilterMode.Transparent) this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, .75);
		else this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0);
		const factors = layerBlendFactors(baseLayer.FilterMode) ?? [
			1,
			0,
			1,
			0
		];
		if (baseLayer.FilterMode === FilterMode.None) {
			this.gl.disable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.depthMask(true);
		} else if (baseLayer.FilterMode === FilterMode.Transparent) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(true);
		} else if (baseLayer.FilterMode === FilterMode.Blend) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (baseLayer.FilterMode === FilterMode.Additive) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (baseLayer.FilterMode === FilterMode.AddAlpha) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (baseLayer.FilterMode === FilterMode.Modulate) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		} else if (baseLayer.FilterMode === FilterMode.Modulate2x) {
			this.gl.enable(this.gl.BLEND);
			this.gl.enable(this.gl.DEPTH_TEST);
			this.gl.blendFuncSeparate(...factors);
			this.gl.depthMask(false);
		}
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[diffuseTexture.Image]);
		this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
		if (baseLayer.Shading & LayerShading.NoDepthTest) this.gl.disable(this.gl.DEPTH_TEST);
		if (baseLayer.Shading & LayerShading.NoDepthSet) this.gl.depthMask(false);
		if (typeof baseLayer.TVertexAnimId === "number") {
			const anim = this.rendererData.model.TextureAnims[baseLayer.TVertexAnimId];
			const translationRes = this.interp.vec3(translation, anim.Translation);
			const rotationRes = this.interp.quat(rotation, anim.Rotation);
			const scalingRes = this.interp.vec3(scaling, anim.Scaling);
			fromRotationTranslationScale(texCoordMat4, rotationRes || defaultRotation, translationRes || defaultTranslation, scalingRes || defaultScaling);
			set$3(texCoordMat3, texCoordMat4[0], texCoordMat4[1], 0, texCoordMat4[4], texCoordMat4[5], 0, texCoordMat4[12], texCoordMat4[13], 0);
			this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, texCoordMat3);
		} else this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, identifyMat3);
		this.gl.activeTexture(this.gl.TEXTURE1);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[normalTexture.Image]);
		this.gl.uniform1i(this.shaderProgramLocations.normalSamplerUniform, 1);
		this.gl.activeTexture(this.gl.TEXTURE2);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[ormTexture.Image]);
		this.gl.uniform1i(this.shaderProgramLocations.ormSamplerUniform, 2);
		this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
	}
};
//#endregion
export { ModelRenderer, blpimage_exports as blp, decode as decodeBLP, generate as generateMDL, generate$1 as generateMDX, getImageData as getBLPImageData, layerBlendFactors, layerOpacity, model_exports as model, parse as parseMDL, parse$1 as parseMDX };

//# sourceMappingURL=war3-model.mjs.map
