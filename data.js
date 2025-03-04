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

      const isCountry = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q6256");
      const isHuman = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q5");
      const isCompany = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q4830453");

      async function getRelatedImages(title) {
        const imagesRes = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=images&titles=${encodeURIComponent(title)}&gimlimit=5&prop=imageinfo&iiprop=url|thumburl`);
        const imagesJson = await imagesRes.json();

        return Object.values(imagesJson?.query?.pages || {})
          .map(img => img.imageinfo?.[0]?.thumburl || img.imageinfo?.[0]?.url)
          .filter(Boolean);
      }

      const relatedImages = await getRelatedImages(wikiData.title);

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

        return { label, value: multiple ? resultValues.join(", ") : resultValues[0] };
      }

      let infobox = (await Promise.all([
        isCountry ? getValue("P36", "Ibu kota") : null,
        isCountry ? getValue("P35", "Presiden") : null,
        isCountry ? getValue("P6", "Perdana Menteri") : null,
        isCountry ? getValue("P1082", "Jumlah penduduk") : null,
        isCountry ? getValue("P30", "Benua") : null,
        isCompany ? getValue("P112", "Pendiri", false, true) : null,
        isCompany ? getValue("P169", "CEO") : null,
        isCompany ? getValue("P159", "Kantor pusat") : null,
        isCompany ? getValue("P17", "Negara asal") : null,
        isHuman ? getValue("P569", "Tanggal lahir", true) : null,
        isHuman ? getValue("P69", "Pendidikan", false, true) : null,
      ])).filter(Boolean);

      if (isCountry) {
        infobox = infobox.filter(item => item.label !== "Didirikan");
      }

      if (isCompany) {
        let logo = entity["P154"]?.[0]?.mainsnak?.datavalue?.value || null;
        if (logo) {
          logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logo)}?width=200`;
        }
        wikiData.originalimage = { source: logo };
      }

      if (isCountry) {
        const populationItem = infobox.find(item => item.label === "Jumlah penduduk");
        if (populationItem) {
          populationItem.value = populationItem.value.toString();
        }
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
