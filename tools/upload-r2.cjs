require("dotenv").config({path:require("node:path").join(__dirname,".env.local")});
const fs = require("node:fs");
const path = require("node:path");
const {S3Client,HeadObjectCommand,ListMultipartUploadsCommand,AbortMultipartUploadCommand} = require("@aws-sdk/client-s3");
const {Upload} = require("@aws-sdk/lib-storage");

const projectRoot = path.resolve(__dirname,"..");
const sourceRoot = process.env.THINK_SOURCE_ROOT || "D:\\THINK AGENCY";
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME || "think-agency-portfolio";
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in tools/.env.local.");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot,"data","media-catalog.json"),"utf8"));
const client = new S3Client({
  region:"auto",
  endpoint:`https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle:true,
  maxAttempts:5,
  credentials:{accessKeyId,secretAccessKey}
});

function mimeType(file) {
  const ext=path.extname(file).toLowerCase();
  return ({".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".mp4":"video/mp4",".mov":"video/quicktime"})[ext] || "application/octet-stream";
}
function encodedDownloadName(name) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}
async function uploadFile(file,key,contentType,contentDisposition) {
  try {
    await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
    return false;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
  }
  const uploader=new Upload({
    client,
    params:{Bucket:bucket,Key:key,Body:fs.createReadStream(file),ContentType:contentType,ContentDisposition:contentDisposition,CacheControl:"public, max-age=31536000, immutable"},
    queueSize:1,
    partSize:8*1024*1024,
    leavePartsOnError:false
  });
  await uploader.done();
  return true;
}

function retryable(error) {
  const code=String(error?.code || error?.name || "");
  return /timeout|network|reset|unreachable|eai_again|enotfound/i.test(code) || (error?.$metadata?.httpStatusCode >= 500);
}

async function uploadWithRetry(job) {
  for (let attempt=1;attempt<=8;attempt++) {
    try { return await uploadFile(job.file,job.key,job.type,job.disposition); }
    catch (error) {
      if (attempt===8 || !retryable(error)) throw error;
      const delay=Math.min(60000,3000*2**(attempt-1));
      console.warn(`Retry ${attempt}/8 for ${job.key} after a temporary connection error; waiting ${Math.round(delay/1000)}s.`);
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}

async function abortAbandonedMultipartUploads() {
  let keyMarker,uploadIdMarker,aborted=0;
  do {
    const result=await client.send(new ListMultipartUploadsCommand({Bucket:bucket,KeyMarker:keyMarker,UploadIdMarker:uploadIdMarker}));
    for (const upload of result.Uploads || []) {
      await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:upload.Key,UploadId:upload.UploadId}));
      aborted++;
    }
    keyMarker=result.NextKeyMarker;
    uploadIdMarker=result.NextUploadIdMarker;
    if (!result.IsTruncated) break;
  } while (true);
  if (aborted) console.log(`Cleared ${aborted} abandoned multipart uploads.`);
}

async function main() {
  try { await abortAbandonedMultipartUploads(); }
  catch (error) { console.warn(`Could not clean abandoned multipart uploads yet: ${error.message || error}`); }
  const jobs=[];
  for (const company of catalog.companies) {
    for (const asset of company.assets) {
      const original=path.join(sourceRoot,...asset.sourceRelativePath.split("/"));
      if (asset.kind === "video") {
        const stream=path.join(projectRoot,"media-upload",...asset.streamKey.split("/"));
        jobs.push({file:stream,key:asset.downloadKey,type:"video/mp4",disposition:encodedDownloadName(asset.downloadFileName || asset.fileName),label:`${company.folder} / ${asset.sourceRelativePath} (download)`,video:true});
        jobs.push({file:stream,key:asset.streamKey,type:"video/mp4",disposition:"inline",label:`${company.folder} / ${asset.sourceRelativePath} (playback)`,video:true});
      } else jobs.push({file:original,key:asset.downloadKey,type:mimeType(original),disposition:encodedDownloadName(asset.fileName),label:`${company.folder} / ${asset.sourceRelativePath}`,video:false});
    }
  }
  let completed=0,uploaded=0;
  async function uploadGroup(group,workerCount) {
    let cursor=0;
    async function worker() {
      while (cursor<group.length) {
        const job=group[cursor++];
        if (await uploadWithRetry(job)) uploaded++;
        console.log(`[${++completed}/${jobs.length}] ${job.label}`);
      }
    }
    await Promise.all(Array.from({length:Math.min(workerCount,group.length)},worker));
  }
  await Promise.all([uploadGroup(jobs.filter(job=>!job.video),4),uploadGroup(jobs.filter(job=>job.video),2)]);
  console.log(`Uploaded ${uploaded} new R2 objects to ${bucket}; checked ${jobs.length} total objects.`);
}

main().catch(error=>{console.error(error.message || error);process.exitCode=1;});
