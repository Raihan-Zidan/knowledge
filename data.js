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
      const entityDesc = entityData.entities[wikidataId]?.descriptions?.en?.value || "No description";

      const isCompany = entity["P31"]?.some(e => e.mainsnak?.datavalue?.value?.id === "Q4830453");

      let logo = null;
      if (isCompany && entity["P154"]) {
        const logoFile = entity["P154"][0]?.mainsnak?.datavalue?.value;
        if (logoFile) {
          logo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logoFile)}?width=300`;
        }
      }
      if (!logo) {
        logo = wikiData.originalimage?.source || "Tidak tersedia";
      }

      const getValue = async (prop, label, isDate = false, multiple = false) => {
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
      };

      let infobox = (await Promise.all([
        getValue("P571", "Didirikan", true),
        getValue("P112", "Pendiri", false, true),
        getValue("P749", "Induk"),
        getValue("P159", "Kantor pusat"),
        getValue("P39", "Jabatan"),
        getValue("P569", "Tanggal lahir", true),
        getValue("P570", "Tanggal wafat", true),
        getValue("P166", "Penghargaan"),
        getValue("P101", "Bidang"),
        getValue("P106", "Profesi"),
        getValue("P495", "Negara produksi"),
        getValue("P577", "Tanggal rilis", true)
      ])).filter(Boolean);

      if (infobox.length < 5) {
        const extraProps = await Promise.all([
          getValue("P856", "Situs web"),
          getValue("P625", "Koordinat"),
          getValue("P102", "Partai politik"),
          getValue("P69", "Pendidikan"),
          getValue("P212", "ISBN")
        ]);
        infobox.push(...extraProps.filter(Boolean));
      }

      infobox = infobox.filter(item => !(item.label === "Situs web" && !item.value.includes(query.toLowerCase())));

      const result = {
        title: wikiData.title,
        type: entityDesc,
        description: wikiData.extract,
        logo,
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
