const config = window.THINK_CONFIG || {};
const mediaBaseUrl = (config.mediaBaseUrl || "").replace(/\/$/, "");
const grid = document.querySelector("#company-grid");
const galleryDialog = document.querySelector("#gallery-dialog");
const viewerDialog = document.querySelector("#viewer-dialog");
const galleryContent = document.querySelector("#gallery-content");
const viewerContent = document.querySelector("#viewer-content");
let companies = [];
let catalog = [];
let activeCompany = null;
let activeFilter = "all";

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const encodeObjectKey = key => String(key || "").split("/").map(encodeURIComponent).join("/");
const remoteUrl = key => mediaBaseUrl && key ? `${mediaBaseUrl}/${encodeObjectKey(key)}` : "";
const assetLabel = asset => asset.kind === "video" ? "Film" : asset.category === "render" ? "Render" : "Image";
const folderLabel = folder => /^(v|video|videos|vedio)$/i.test(String(folder).trim()) ? "Videos" : folder;
const formatSize = bytes => {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
};
const formatDuration = seconds => {
  if (!seconds) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

async function loadPortfolio() {
  try {
    const [companyResponse, catalogResponse] = await Promise.all([
      fetch("data/companies.json"),
      fetch("data/media-catalog.json")
    ]);
    if (!companyResponse.ok || !catalogResponse.ok) throw new Error("Portfolio data is unavailable.");
    companies = await companyResponse.json();
    catalog = await catalogResponse.json();
    const catalogByFolder = new Map(catalog.companies.map(company => [company.folder, company]));
    companies = companies.map(company => ({...company, ...(catalogByFolder.get(company.folder) || {})}));
    renderCompanyCards();
    updateCounts();
  } catch (error) {
    grid.innerHTML = '<p class="empty-media">The portfolio index could not be loaded. Refresh the page to try again.</p>';
    console.error(error);
  }
}

function updateCounts() {
  const assets = companies.flatMap(company => company.assets || []);
  const images = assets.filter(asset => asset.kind === "image").length;
  const videos = assets.filter(asset => asset.kind === "video").length;
  document.querySelector("#company-count").textContent = String(companies.length);
  document.querySelector("#image-count").textContent = String(images);
  document.querySelector("#video-count").textContent = String(videos);
}

function companyMark(company) {
  if (!company.logo) return `<span class="company-wordmark">${escapeHtml(company.name)}</span>`;
  const dark = company.logoMode === "dark" ? " mark-dark" : "";
  return `<img src="${escapeHtml(company.logo)}" alt="${escapeHtml(company.name)} logo" loading="lazy" decoding="async" />`;
}

function renderCompanyCards() {
  grid.innerHTML = companies.map(company => {
    const assets = company.assets || [];
    const images = assets.filter(asset => asset.kind === "image").length;
    const videos = assets.filter(asset => asset.kind === "video").length;
    const folder = escapeHtml(company.folder);
    return `<button class="company-card reveal" type="button" data-company="${escapeHtml(company.id)}" aria-label="Open ${escapeHtml(company.name)} portfolio">
      <span class="company-mark${company.logoMode === "dark" ? " mark-dark" : ""}">${companyMark(company)}</span>
      <span class="company-meta"><span><strong>${escapeHtml(company.name)}</strong><small>${images} images · ${videos} film${videos === 1 ? "" : "s"}</small></span><span class="company-arrow" aria-hidden="true">↗</span></span>
      <span class="sr-only">Source folder: ${folder}</span>
    </button>`;
  }).join("");
  grid.querySelectorAll(".company-card").forEach(button => {
    button.addEventListener("click", () => openCompany(button.dataset.company));
  });
  observeReveal();
}

function openCompany(companyId) {
  activeCompany = companies.find(company => company.id === companyId);
  if (!activeCompany) return;
  activeFilter = "all";
  document.querySelector("#gallery-folder").textContent = `SOURCE FOLDER / ${activeCompany.folder}`;
  document.querySelector("#gallery-title").textContent = activeCompany.name;
  const assets = activeCompany.assets || [];
  const photos = assets.filter(asset => asset.kind === "image").length;
  const films = assets.filter(asset => asset.kind === "video").length;
  document.querySelector("#gallery-summary").textContent = `${photos} images and renders · ${films} film${films === 1 ? "" : "s"}. Files stay grouped under this company folder.`;
  renderFilters();
  renderGallery();
  galleryDialog.showModal();
  galleryDialog.scrollTop = 0;
  document.body.classList.add("dialog-open");
}

const filterOptions = [
  {id:"all", label:"All work"},
  {id:"photo", label:"Photos"},
  {id:"render", label:"Renders"},
  {id:"video", label:"Films"}
];

function renderFilters() {
  const assets = activeCompany?.assets || [];
  document.querySelector("#gallery-filters").innerHTML = filterOptions.map(option => {
    const count = option.id === "all" ? assets.length : assets.filter(asset => option.id === "video" ? asset.kind === "video" : asset.kind === "image" && asset.category === option.id).length;
    return `<button class="filter-button" type="button" data-filter="${option.id}" aria-pressed="${activeFilter === option.id}">${option.label} <span>${count}</span></button>`;
  }).join("");
  document.querySelectorAll(".filter-button").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      renderFilters();
      renderGallery();
    });
  });
}

function filteredAssets() {
  const assets = activeCompany?.assets || [];
  if (activeFilter === "all") return assets;
  if (activeFilter === "video") return assets.filter(asset => asset.kind === "video");
  return assets.filter(asset => asset.kind === "image" && asset.category === activeFilter);
}

function downloadTarget(asset) {
  if (mediaBaseUrl && asset.downloadKey) return remoteUrl(asset.downloadKey);
  return "";
}

function renderGallery() {
  const assets = filteredAssets();
  if (!assets.length) {
    galleryContent.innerHTML = '<div class="empty-media">There are no files in this group yet.</div>';
    return;
  }
  const groups = new Map();
  for (const asset of assets) {
    const folder = asset.folderPath || "Main folder";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(asset);
  }
  galleryContent.innerHTML = [...groups.entries()].map(([folder, items]) => `
    <section class="folder-section" aria-label="${escapeHtml(folderLabel(folder))}">
      <h3 class="folder-heading"><span>${escapeHtml(folder.toLowerCase() === "v" ? "Videos" : folder)}</span><small>${items.length} ${items.length === 1 ? "file" : "files"}</small></h3>
      <div class="media-grid">${items.map(mediaCard).join("")}</div>
    </section>`).join("");
  galleryContent.querySelectorAll(".media-open").forEach(button => {
    button.addEventListener("click", () => openViewer(button.dataset.asset));
  });
  galleryContent.querySelectorAll(".download-link[aria-disabled='true']").forEach(link => {
    link.addEventListener("click", event => event.preventDefault());
  });
}

function mediaCard(asset) {
  const isVideo = asset.kind === "video";
  const image = asset.preview ? `<img src="${escapeHtml(asset.preview)}" alt="${escapeHtml(asset.title)}" loading="lazy" decoding="async"${asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : ""} />` : "";
  const play = isVideo ? '<span class="play-mark" aria-hidden="true">▶</span>' : "";
  const target = downloadTarget(asset);
  const disabled = !target;
  const size = formatSize(asset.downloadBytes || asset.sizeBytes);
  const duration = formatDuration(asset.durationSeconds);
  return `<article class="media-card">
    <button class="media-open" type="button" data-asset="${escapeHtml(asset.id)}" aria-label="${isVideo ? "View film" : "View image"}: ${escapeHtml(asset.title)}">
      <span class="media-visual">${image}${play}</span>
      <span class="media-title">${escapeHtml(asset.title)}</span>
      <span class="media-subtitle">${assetLabel(asset)}${duration ? ` · ${duration}` : ""}</span>
    </button>
    <div class="media-actions"><span class="media-size">${size}</span><a class="download-link" href="${disabled ? "#" : escapeHtml(target)}" ${disabled ? 'aria-disabled="true" title="R2 media is not connected yet"' : `download="${escapeHtml(asset.downloadFileName || asset.fileName)}"`} aria-label="Download ${escapeHtml(asset.title)}">↓ <span>Download</span></a></div>
  </article>`;
}

function openViewer(assetId) {
  const asset = (activeCompany?.assets || []).find(item => item.id === assetId);
  if (!asset) return;
  const download = downloadTarget(asset);
  if (asset.kind === "image") {
    viewerContent.innerHTML = `<img class="viewer-image" src="${escapeHtml(asset.preview)}" alt="${escapeHtml(asset.title)}" />${download ? `<a class="viewer-download" href="${escapeHtml(download)}" download="${escapeHtml(asset.fileName)}">Download image ↓</a>` : ""}`;
  } else {
    const stream = mediaBaseUrl && asset.streamKey ? remoteUrl(asset.streamKey) : "";
    viewerContent.innerHTML = stream
      ? `<video class="viewer-video" controls autoplay playsinline preload="auto" poster="${escapeHtml(asset.preview || "")}"><source src="${escapeHtml(stream)}" type="video/mp4" /></video>${download ? `<a class="viewer-download" href="${escapeHtml(download)}" download="${escapeHtml(asset.downloadFileName || asset.fileName)}">Download film ↓</a>` : ""}`
      : '<div class="viewer-unavailable"><strong>Film ready for Cloudflare R2</strong><p>Connect the media domain in site-config.js after the R2 files are uploaded.</p></div>';
  }
  viewerDialog.showModal();
  const video = viewerContent.querySelector("video");
  if (video) video.play().catch(() => {});
}

document.querySelector("#close-gallery").addEventListener("click", () => galleryDialog.close());
document.querySelector("#close-viewer").addEventListener("click", () => viewerDialog.close());
galleryDialog.addEventListener("click", event => { if (event.target === galleryDialog) galleryDialog.close(); });
viewerDialog.addEventListener("click", event => { if (event.target === viewerDialog) viewerDialog.close(); });
viewerDialog.addEventListener("close", () => { viewerContent.innerHTML = ""; });
galleryDialog.addEventListener("close", () => { viewerDialog.close(); document.body.classList.remove("dialog-open"); });
document.querySelector("#year").textContent = String(new Date().getFullYear());

const contactLink = document.querySelector("#contact-link");
if (config.contactUrl) contactLink.href = config.contactUrl;
else if (config.contactEmail) contactLink.href = `mailto:${config.contactEmail}`;
else {
  contactLink.href = "#work";
  contactLink.innerHTML = 'Explore the work <span aria-hidden="true">↓</span>';
  document.querySelector("#nav-contact").hidden = true;
}

const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
menuToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});
navLinks.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  navLinks.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
}));

let revealObserver;
function observeReveal() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal").forEach(element => element.classList.add("is-visible"));
    return;
  }
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, {threshold:.12});
  document.querySelectorAll(".reveal:not(.is-visible)").forEach(element => revealObserver.observe(element));
}

observeReveal();
loadPortfolio();
