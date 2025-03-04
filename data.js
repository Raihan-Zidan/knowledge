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

      async function getValue(prop, label, isDate = false, latestOnly = false) {
        if (!entity[prop]) return null;

        let values = entity[prop].map(e => e.mainsnak?.datavalue?.value).filter(Boolean);
        if (values.length === 0) return null;

        if (latestOnly) {
          values = values.sort((a, b) => (b.rank === "preferred" ? 1 : -1)).slice(0, 1);
        }

        if (isDate) {
          return { label, value: values[0].time.substring(1, 11) };
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

        return { label, value: resultValues.join(", ") };
      }

      let infobox = (await Promise.all([
        getValue("P35", "Presiden", false, true), // Hanya presiden saat ini
        getValue("P6", "Perdana Menteri"),
        getValue("P1082", "Jumlah penduduk"),
        getValue("P36", "Ibu kota"),
        getValue("P30", "Benua"),
        getValue("P112", "Pendiri"),
        getValue("P169", "CEO"),
        getValue("P159", "Kantor pusat"),
        getValue("P569", "Tanggal lahir", true),
        getValue("P69", "Pendidikan"),
        getValue("P26", "Pasangan"),
        getValue("P40", "Anak"),
        getValue("P22", "Orang tua")
      ])).filter(Boolean);

      // Fix jumlah penduduk jadi string
      const populationItem = infobox.find(e => e.label === "Jumlah penduduk");
      if (populationItem) {
        populationItem.value = populationItem.value.toString();
      }

      // Hilangkan Perdana Menteri kalau gak ada
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

      // Ambil logo perusahaan yang benar
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
