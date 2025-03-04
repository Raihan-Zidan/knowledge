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
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      if (!wikiRes.ok) throw new Error("Wikipedia data not found");
      const wikiData = await wikiRes.json();

      const pageId = wikiData.pageid;
      const wikidataRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&pageids=${pageId}&format=json`);
      const wikidataJson = await wikidataRes.json();
      const wikidataId = wikidataJson.query.pages[pageId]?.pageprops?.wikibase_item;

      if (!wikidataId) throw new Error("Wikidata ID not found");

      const entityRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`);
      const entityData = await entityRes.json();
      const entity = entityData.entities[wikidataId]?.claims || {};
      let entityDesc = entityData.entities[wikidataId]?.descriptions?.en?.value || "No description";

      console.log("Entity Data:", JSON.stringify(entity, null, 2)); // Debugging API response

      async function getValue(prop, label, isDate = false, latestOnly = false, isNumeric = false, isList = false) {
        if (!entity[prop]) {
          console.log(`Properti ${label} (${prop}) tidak ditemukan di Wikidata`);
          return null;
        }

        let values = entity[prop].map(e => e.mainsnak?.datavalue?.value).filter(Boolean);
        if (values.length === 0) {
          console.log(`Properti ${label} (${prop}) kosong di Wikidata`);
          return null;
        }

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

        const fallback = "Tidak tersedia";
        return { label, value: isList ? resultValues : resultValues.length > 0 ? resultValues.join(", ") : fallback };
      }

      let infobox = (await Promise.all([
        getValue("P35", "Presiden", false, true),
        getValue("P6", "Perdana Menteri"),
        getValue("P1082", "Jumlah penduduk", false, true, true),
        getValue("P36", "Ibu kota", false, true),
        getValue("P30", "Benua"),
        getValue("P112", "Pendiri", false, false, false, true),
        getValue("P169", "CEO"),
        getValue("P159", "Kantor pusat"),
        getValue("P1128", "Jumlah karyawan", false, true, true),
        getValue("P2139", "Pendapatan", false, true, true),
        getValue("P569", "Kelahiran", true),
        getValue("P69", "Pendidikan", false, false, false, true),
        getValue("P26", "Pasangan"),
        getValue("P40", "Anak", false, false, false, true),
        getValue("P22", "Orang tua", false, false, false, true),
        getValue("P3373", "Saudara kandung", false, false, false, true),
        getValue("P27", "Kewarganegaraan"),
        getValue("P106", "Pekerjaan", false, false, false, true),
        getValue("P166", "Penghargaan", false, false, false, true),
        getValue("P452", "Industri"),
        getValue("P2541", "Area operasi") // Tambahan area operasi perusahaan
      ])).filter(Boolean);

      if (!infobox.some(e => e.label === "Perdana Menteri")) {
        infobox = infobox.filter(e => e.label !== "Perdana Menteri");
      }

      async function getRelatedImages(title) {
        try {
          const imagesRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=images&titles=${encodeURIComponent(title)}&format=json`);
          const imagesJson = await imagesRes.json();
          const imageTitles = Object.values(imagesJson.query.pages || {}).flatMap(p => p.images?.map(img => img.title) || []);
          const imageUrls = await Promise.all(imageTitles.map(async title => {
            const urlRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&format=json`);
            const urlJson = await urlRes.json();
            return Object.values(urlJson.query.pages || {}).map(p => p.imageinfo?.[0]?.url).filter(Boolean);
          }));
          return imageUrls.flat();
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
