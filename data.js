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
      let entityDesc = entityData.entities[wikidataId]?.descriptions?.en?.value || "No description";

      const isImportant = ["Q5", "Q6256"].some(type => entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === type));
      const isCompany = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q4830453");

      let logo = entity["P154"]?.[0]?.mainsnak?.datavalue?.value || wikiData.originalimage?.source || "Tidak tersedia";

      async function getRelatedImages(title) {
        const imagesRes = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=images&titles=${encodeURIComponent(title)}&gimlimit=5&prop=imageinfo&iiprop=url|thumburl`);
        const imagesJson = await imagesRes.json();

        return Object.values(imagesJson?.query?.pages || {})
          .map(img => img.imageinfo?.[0]?.thumburl)
          .filter(Boolean);
      }

      const relatedImages = isImportant ? await getRelatedImages(wikiData.title) : [];

      const getValue = async (prop, label, isDate = false, multiple = false, filterAwards = false) => {
        const values = entity[prop]?.map(e => e.mainsnak?.datavalue?.value).filter(Boolean) || [];
        if (values.length === 0) return null;

        if (isDate) {
          return { label, value: values[0].time.substring(1, 11) };
        }

        const resultValues = await Promise.all(values.map(async data => {
          if (typeof data === "object" && data.id) {
            const labelRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${data.id}.json`);
            const labelJson = await labelRes.json();
            const labelValue = labelJson.entities[data.id]?.labels?.en?.value || "Unknown";

            if (filterAwards && ["Star of the Republic of Indonesia", "Bintang Mahaputera"].includes(labelValue)) {
              return null;
            }
            return labelValue;
          }
          return data;
        }));

        const filteredValues = resultValues.filter(Boolean);
        return filteredValues.length > 0 ? { label, value: multiple ? filteredValues.join(", ") : filteredValues[0] } : null;
      };

      let infobox = (await Promise.all([
        getValue("P571", "Didirikan", true),
        getValue("P112", "Pendiri", false, true),
        getValue("P749", "Induk"),
        getValue("P159", "Kantor pusat"),
        getValue("P39", "Jabatan", false, true),
        getValue("P569", "Tanggal lahir", true),
        getValue("P570", "Tanggal wafat", true),
        getValue("P166", "Penghargaan", false, true, true),
        getValue("P101", "Bidang"),
        getValue("P106", "Profesi"),
        getValue("P495", "Negara produksi"),
        getValue("P577", "Tanggal rilis", true)
      ])).filter(Boolean);

      if (infobox.length < 5) {
        const extraProps = await Promise.all([
          getValue("P856", "Situs web"),
          getValue("P102", "Partai politik"),
          getValue("P69", "Pendidikan"),
          getValue("P212", "ISBN")
        ]);
        infobox.push(...extraProps.filter(Boolean));
      }

      infobox = infobox.filter(item => !(item.label === "Situs web" && !item.value.includes(query.toLowerCase())));

      infobox = infobox.map(item => {
        if (item.label === "Jabatan") {
          const positions = entity["P39"] || [];
          const updatedValues = positions.map(pos => {
            const posData = pos.mainsnak?.datavalue?.value?.id;
            const startTime = pos.qualifiers?.P580?.[0]?.datavalue?.value?.time?.substring(1, 11);
            const endTime = pos.qualifiers?.P582?.[0]?.datavalue?.value?.time?.substring(1, 11);

            if (posData && (startTime || endTime)) {
              return `${item.value} (${startTime || "?"} - ${endTime || "sekarang"})`;
            }
            return item.value;
          });

          return { label: "Jabatan", value: updatedValues.join(", ") };
        }
        return item;
      });

      const result = {
        title: wikiData.title,
        type: entityDesc,
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
