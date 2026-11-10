/* Build lightweight local gallery previews and R2-ready MP4 playback copies.
   Source media stays in its original company folder and is never modified. */
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = process.env.THINK_SOURCE_ROOT || "D:\\THINK AGENCY";
const ffmpeg = process.env.FFMPEG_PATH || require("ffmpeg-static");
const companies = require(path.join(projectRoot, "data", "companies.json"));
const previewRoot = path.join(projectRoot, "media-preview");
const streamRoot = path.join(projectRoot, "media-upload", "stream");
const catalogPath = path.join(projectRoot, "data", "media-catalog.json");
const imageExts = new Set([".jpg", ".jpeg", ".png"]);
const videoExts = new Set([".mp4", ".mov"]);

function runFfmpeg(args) {
  const result = spawnSync(ffmpeg, args, {encoding:"utf8", windowsHide:true, maxBuffer:16 * 1024 * 1024});
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || "ffmpeg failed").slice(-1600));
}

function readBoxHeader(fd, offset, fileSize) {
  const header = Buffer.alloc(16);
  const read = fsSync.readSync(fd, header, 0, 16, offset);
  if (read < 8) return null;
  let size = BigInt(header.readUInt32BE(0));
  let headerSize = 8;
  if (size === 1n) { if (read < 16) return null; size = header.readBigUInt64BE(8); headerSize = 16; }
  if (size === 0n) size = BigInt(fileSize - offset);
  if (size < BigInt(headerSize) || size > BigInt(fileSize - offset)) return null;
  return {size:Number(size), headerSize, type:header.toString("ascii", 4, 8)};
}

function getDurationSeconds(file) {
  const fd = fsSync.openSync(file, "r");
  try {
    const fileSize = fsSync.fstatSync(fd).size;
    let offset = 0;
    while (offset + 8 <= fileSize) {
      const box = readBoxHeader(fd, offset, fileSize);
      if (!box) break;
      if (box.type === "moov" && box.size <= 64 * 1024 * 1024) {
        const moov = Buffer.alloc(box.size);
        fsSync.readSync(fd, moov, 0, moov.length, offset);
        let childOffset = box.headerSize;
        while (childOffset + 8 <= moov.length) {
          const childSize = moov.readUInt32BE(childOffset);
          const childType = moov.toString("ascii", childOffset + 4, childOffset + 8);
          if (childSize < 8 || childOffset + childSize > moov.length) break;
          if (childType === "mvhd") {
            const content = childOffset + 8;
            const version = moov[content];
            if (version === 1) {
              const timescale = moov.readUInt32BE(content + 20);
              const duration = Number(moov.readBigUInt64BE(content + 24));
              return timescale ? duration / timescale : null;
            }
            const timescale = moov.readUInt32BE(content + 12);
            const duration = moov.readUInt32BE(content + 16);
            return timescale ? duration / timescale : null;
          }
          childOffset += childSize;
        }
        break;
      }
      offset += box.size;
    }
  } finally { fsSync.closeSync(fd); }
  return null;
}

async function walk(dir) {
  const items = [];
  for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) items.push(...await walk(fullPath));
    else if (imageExts.has(path.extname(entry.name).toLowerCase()) || videoExts.has(path.extname(entry.name).toLowerCase())) items.push(fullPath);
  }
  return items.sort((a,b) => a.localeCompare(b, "en", {numeric:true, sensitivity:"base"}));
}

function classify(relativePath, isVideo) {
  if (isVideo) return "video";
  return relativePath.split(path.sep).some(part => /^renders?$/i.test(part)) ? "render" : "photo";
}

async function ensureParent(file) { await fs.mkdir(path.dirname(file), {recursive:true}); }

async function makeImagePreview(input, output) {
  await ensureParent(output);
  await sharp(input).rotate().resize({width:1280,height:1280,fit:"inside",withoutEnlargement:true})
    .webp({quality:78,effort:4,smartSubsample:true,alphaQuality:82}).toFile(output);
  const meta = await sharp(output).metadata();
  return {width:meta.width,height:meta.height};
}

async function makeVideoAssets(input, outputStream, outputPoster, duration) {
  await ensureParent(outputStream);
  await ensureParent(outputPoster);
  const position = Math.max(0.5, Math.min(3, (duration || 12) * 0.12));
  const posterJpg = `${outputPoster}.frame.jpg`;
  runFfmpeg(["-hide_banner","-loglevel","error","-y","-ss",String(position),"-i",input,"-frames:v","1","-vf","scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2","-q:v","3",posterJpg]);
  await sharp(posterJpg).webp({quality:78,effort:4}).toFile(outputPoster);
  await fs.rm(posterJpg,{force:true});
  runFfmpeg([
    "-hide_banner","-loglevel","error","-y","-i",input,
    "-map","0:v:0","-map","0:a:0?","-vf","scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v","libx264","-preset","veryfast","-b:v","5000k","-maxrate","6000k","-bufsize","12000k","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","128k","-ac","2","-sn","-dn","-map_metadata","-1","-movflags","+faststart",outputStream
  ]);
  const [posterMeta, streamStat] = await Promise.all([sharp(outputPoster).metadata(),fs.stat(outputStream)]);
  return {width:posterMeta.width,height:posterMeta.height,streamBytes:streamStat.size};
}

async function main() {
  const records = [];
  let totalImages = 0, totalVideos = 0;
  let processed = 0;
  const companyInputs = [];
  let totalAssets = 0;
  for (const company of companies) {
    const companyRoot = path.join(sourceRoot, company.folder);
    await fs.access(companyRoot);
    const filePaths = await walk(companyRoot);
    companyInputs.push({company,companyRoot,filePaths});
    totalAssets += filePaths.length;
  }
  sharp.concurrency(1);
  for (const {company,companyRoot,filePaths} of companyInputs) {
    const assets = [];
    const jobs = filePaths.map((input,index) => {
      const extension = path.extname(input).toLowerCase();
      const kind = videoExts.has(extension) ? "video" : "image";
      const relativePath = path.relative(companyRoot, input);
      const sourceRelative = path.posix.join(company.folder, relativePath.split(path.sep).join("/"));
      const videoDownloadName=path.basename(input).replace(/\.[^.]+$/, "") + (extension === ".mov" ? "--mov" : "") + ".mp4";
      const downloadRelative=kind === "video" ? path.join(path.dirname(relativePath),videoDownloadName) : relativePath;
      const id = `${company.id}-${String(index + 1).padStart(3,"0")}`;
      const previewRelative = path.posix.join("media-preview", company.id, `${id}.webp`);
      const previewOutput = path.join(projectRoot, ...previewRelative.split("/"));
      return {input,kind,relativePath,previewOutput,asset:{
        id, kind, category:classify(relativePath,kind === "video"), title:path.basename(input,path.extname(input)),
        fileName:path.basename(input), downloadFileName:kind === "video" ? videoDownloadName : path.basename(input), folderPath:path.dirname(relativePath) === "." ? "Main folder" : path.dirname(relativePath).split(path.sep).join(" / "),
        sourceRelativePath:sourceRelative, preview:previewRelative,
        downloadKey:path.posix.join("downloads",company.id,downloadRelative.split(path.sep).join("/"))
      }};
    });
    const images = jobs.filter(job=>job.kind === "image");
    const videos = jobs.filter(job=>job.kind === "video");
    for (let offset=0;offset<images.length;offset+=4) {
      await Promise.all(images.slice(offset,offset+4).map(async job=>{
        const sourceStat=await fs.stat(job.input);
        Object.assign(job.asset,{sizeBytes:sourceStat.size,...await makeImagePreview(job.input,job.previewOutput)});
        assets.push(job.asset); totalImages++;
        console.log(`[${++processed}/${totalAssets}] ${company.folder} / ${path.basename(job.input)}`);
      }));
    }
    for (const job of videos) {
      const sourceStat=await fs.stat(job.input);
      const durationSeconds=getDurationSeconds(job.input);
      const streamName=path.basename(job.relativePath).replace(/\.[^.]+$/, "") + (extension === ".mov" ? "--mov" : "") + ".mp4";
      const streamRelative=path.posix.join("media-upload","stream",company.id,path.dirname(job.relativePath).split(path.sep).join("/"),streamName);
      const streamOutput=path.join(projectRoot,...streamRelative.split("/"));
      const streamKey=path.posix.join("stream",company.id,path.dirname(job.relativePath).split(path.sep).join("/"),streamName);
      const streamInfo=await makeVideoAssets(job.input,streamOutput,job.previewOutput,durationSeconds);
      Object.assign(job.asset,{sizeBytes:sourceStat.size,downloadBytes:streamInfo.streamBytes,durationSeconds:durationSeconds ? Number(durationSeconds.toFixed(2)) : null,width:streamInfo.width,height:streamInfo.height,streamBytes:streamInfo.streamBytes,streamKey});
      assets.push(job.asset); totalVideos++;
      console.log(`[${++processed}/${totalAssets}] ${company.folder} / ${path.basename(job.input)}`);
    }
    assets.sort((a,b)=>a.sourceRelativePath.localeCompare(b.sourceRelativePath,"en",{numeric:true,sensitivity:"base"}));
    records.push({id:company.id,folder:company.folder,name:company.name,assets});
  }
  const catalog = {sourceName:"THINK AGENCY",generatedAt:new Date().toISOString(),companyCount:records.length,imageCount:totalImages,videoCount:totalVideos,companies:records};
  await fs.writeFile(catalogPath,JSON.stringify(catalog,null,2)+"\n","utf8");
  console.log(`Prepared ${totalImages} images and ${totalVideos} videos across ${records.length} separate company folders.`);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
