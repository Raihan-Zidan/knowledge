export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query) {
      return new Response(JSON.stringify({ error: "Query tidak boleh kosong" }, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }

    try {
      const wikiRes = await fetch(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      if (!wikiRes.ok) throw new Error("Wikipedia data not found");
      const wikiData = await wikiRes.json();

      const pageId = wikiData.pageid;
      const wikidataRes = await fetch(`https://id.wikipedia.org/w/api.php?action=query&prop=pageprops&pageids=${pageId}&format=json`);
      const wikidataJson = await wikidataRes.json();
      const wikidataId = wikidataJson.query.pages[pageId]?.pageprops?.wikibase_item;

      if (!wikidataId) throw new Error("Wikidata ID not found");

      const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
      const entityData = await entityRes.json();
      const entity = entityData.entities[wikidataId]?.claims || {};
      let entityDesc = entityData.entities[wikidataId]?.descriptions?.id?.value || "No description";

      async function getValue(prop, label, isDate = false, latestOnly = false, isNumeric = false) {
        if (!entity[prop]) return null;

        let values = entity[prop].map(e => e.mainsnak?.datavalue?.value).filter(Boolean);
        if (values.length === 0) return null;

        if (latestOnly) {
          values = values.slice(-1);
        }

        if (isDate) {
          return { label, value: values[0].time.substring(1, 11) };
        }

        if (isNumeric) {
          return { label, value: parseInt(values[0].amount || values[0]).toLocaleString() };
        }

        const resultValues = await Promise.all(values.map(async data => {
          if (typeof data === "object" && data.id) {
            try {
              const labelRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${data.id}.json`);
              const labelJson = await labelRes.json();
              return labelJson.entities[data.id]?.labels?.en?.value || "Unknown";
            } catch {
              return "Unknown";
            }
          }
          return data.toString();
        }));

        return { label, value: resultValues.join(", ") || "Tidak tersedia" };
      }

      let infobox = (await Promise.all([
        getValue("P35", "Pemimpin", false, true),
        getValue("P1082", "Jumlah penduduk", false, true, true),
        getValue("P36", "Ibu kota", false, true),
        getValue("P30", "Benua"),
        getValue("P112", "Pendiri"),
        getValue("P169", "CEO"),
        getValue("P159", "Kantor pusat"),
        getValue("P1128", "Jumlah karyawan", false, true, true),
        getValue("P2139", "Pendapatan", false, true, true),
        getValue("P569", "Kelahiran", true),
        getValue("P69", "Pendidikan"),
        getValue("P26", "Pasangan"),
        getValue("P40", "Anak"),
        getValue("P22", "Orang tua"),
        getValue("P3373", "Saudara kandung"),
        getValue("P27", "Kewarganegaraan"),
        getValue("P106", "Pekerjaan"),
        getValue("P166", "Penghargaan"),
        getValue("P452", "Industri"),
        getValue("P2541", "Area operasi"), // **Tambahan area operasi perusahaan**
                
        getValue("P571", "Berdiri", true),
        getValue("P749", "Induk Perusahaan"),
        getValue("P127", "Pemilik"),

        getValue("P355", "Anak perusahaan"),
getValue("P2046", "Luas wilayah", true),
getValue("P37", "Bahasa"),
      ])).filter(Boolean);

async function getRelatedImages(title) {
  try {
    const imagesRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=images&titles=${encodeURIComponent(title)}&format=json`);
    const imagesJson = await imagesRes.json();
    const imageTitles = Object.values(imagesJson.query.pages || {}).flatMap(p => p.images?.map(img => img.title) || []);

    const imageUrls = await Promise.all(imageTitles.map(async title => {
      const urlRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size&format=json`);
      const urlJson = await urlRes.json();
      return Object.values(urlJson.query.pages || {}).map(p => ({
        url: p.imageinfo?.[0]?.url,
        size: p.imageinfo?.[0]?.width || 0
      })).filter(Boolean);
    }));

    return imageUrls.flat()
      .filter(img => img.size > 100) // **Skip gambar kecil (biasanya icon)**
      .filter(img => !/icon|symbol|logo|Crystal_Clear|OOjs|Flag_of|Industry\d/i.test(img.url)) // **Skip gambar icon/simbol yang nggak relevan**
      .map(img => img.url);
  } catch {
    return [];
  }
}

      const relatedImages = await getRelatedImages(wikiData.title);

      let logo = entity["P154"]?.[0]?.mainsnak?.datavalue?.value;
      if (logo) {
        logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logo)}?width=200`;
      }

      const result = {
        title: wikiData.title,
        type: entityDesc,
        description: wikiData.extract,
        image: wikiData.originalimage?.source || null,
        related_images: relatedImages,
        infobox,
        source: "Wikipedia",
        url: wikiData.content_urls.desktop.page,
        logo
      };

      return new Response(JSON.stringify({ query, results: [result] }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Data tidak ditemukan" }, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    }
  },
};
