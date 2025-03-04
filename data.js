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
      const entity = entityData.entities[wikidataId]?.claims;

      const isImportant = ["Q5", "Q6256", "Q4830453"].some(type => entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === type));
      const isCountry = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q6256");
      const isCompany = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q4830453");

      async function getValue(prop, label, isDate = false, multiple = false) {
        const values = entity[prop]?.map(e => e.mainsnak?.datavalue?.value).filter(Boolean) || [];
        if (values.length === 0) return null;

        if (isDate) {
          return { label, value: values[0].time.substring(1, 11) };
        }

        const resultValues = await Promise.all(values.map(async data => {
          if (typeof data === "object" && data.id) {
            const labelRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${data.id}.json`);
            const labelJson = await labelRes.json();
            return labelJson.entities[data.id]?.labels?.en?.value || "Unknown";
          }
          return data;
        }));

        return resultValues.length > 0 ? { label, value: multiple ? resultValues.join(", ") : resultValues[0] } : null;
      }

      let infobox = [];

      if (isCountry) {
        infobox = (await Promise.all([
          getValue("P571", "Didirikan", true),
          getValue("P36", "Ibu kota"),
          getValue("P6", "Presiden"),
          getValue("P35", "Perdana Menteri"),
          getValue("P1082", "Jumlah penduduk"),
          getValue("P473", "Kode telepon"),
          getValue("P30", "Benua"),
        ])).filter(Boolean);
      } else if (isCompany) {
        infobox = (await Promise.all([
          getValue("P571", "Didirikan", true),
          getValue("P112", "Pendiri", false, true),
          getValue("P169", "CEO"),
          getValue("P159", "Kantor pusat"),
          getValue("P17", "Negara asal"),
          getValue("P2541", "Wilayah operasi", false, true),
        ])).filter(Boolean);
      }

      if (infobox.length < 5) {
        const extraProps = await Promise.all([
          getValue("P856", "Situs web"),
          getValue("P625", "Koordinat"),
          getValue("P102", "Partai politik"),
          getValue("P69", "Pendidikan"),
        ]);
        infobox.push(...extraProps.filter(Boolean));
      }

      infobox = infobox.filter(item => !(item.label === "Koordinat"));

      async function getLogo() {
        if (entity["P154"]) {
          const logoId = entity["P154"][0]?.mainsnak?.datavalue?.value;
          return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logoId)}`;
        }
        return null;
      }

      async function getRelatedImages(title) {
        const imagesRes = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=images&titles=${encodeURIComponent(title)}&gimlimit=5&prop=imageinfo&iiprop=url|thumburl`);
        const imagesJson = await imagesRes.json();

        return Object.values(imagesJson?.query?.pages || {})
          .map(img => img.imageinfo?.[0]?.thumburl || img.imageinfo?.[0]?.url) // Pakai thumbnail kecil dulu, kalau gak ada pakai yang besar
          .filter(Boolean);
      }

      const logo = await getLogo();
      const relatedImages = isImportant ? await getRelatedImages(wikiData.title) : [];

      const result = {
        title: wikiData.title,
        type: entityData.entities[wikidataId]?.descriptions?.en?.value || "No description",
        description: wikiData.extract,
        logo,
        related_images: relatedImages,
        infobox,
        source: "Wikipedia",
        url: wikiData.content_urls.desktop.page,
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
