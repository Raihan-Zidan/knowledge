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

      async function getValue(prop, label, isDate = false) {
        if (!entity[prop]) return null;

        const values = entity[prop].map(e => e.mainsnak?.datavalue?.value).filter(Boolean);
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

        return { label, value: resultValues.join(", ") };
      }

      async function getAllInfobox() {
        let infobox = [];
        for (const prop in entity) {
          if (entity.hasOwnProperty(prop)) {
            const data = await getValue(prop, prop);
            if (data) infobox.push(data);
          }
        }
        return infobox;
      }

      let infobox = await getAllInfobox();

      // Fix untuk presiden & perdana menteri
      if (infobox.some(e => e.label === "P6")) {
        infobox = infobox.map(e => (e.label === "P6" ? { label: "Perdana Menteri", value: e.value } : e));
      } else {
        infobox = infobox.filter(e => e.label !== "Perdana Menteri");
      }

      if (infobox.some(e => e.label === "P35")) {
        infobox = infobox.map(e => (e.label === "P35" ? { label: "Presiden", value: e.value } : e));
      }

      // Fix jumlah penduduk
      const populationItem = infobox.find(e => e.label === "P1082");
      if (populationItem) {
        populationItem.label = "Jumlah penduduk";
        populationItem.value = populationItem.value.toString();
      }

      const result = {
        title: wikiData.title,
        type: entityDesc,
        description: wikiData.extract,
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
