require("dotenv").config();
const express = require("express");
const cors = require("cors");

global.fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_URL = `https://${SHOP}/admin/api/2024-01/graphql.json`;

async function shopifyQuery(query, variables = {}) {
  const res = await fetch(SHOPIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return await res.json();
}

// --- SAVE ATTEMPT TO SHOPIFY ---
async function saveQuizAttempt(primary, secondary, scores, profileId, userData) {
  const mutation = `
    mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metaobject: {
      type: "quiz_attempt",
      fields: [
        { key: "attempt_id", value: String(userData.name || "Anonymous") },
        { key: "customer_email", value: String(userData.email || "no-email@provided.com") },
        { key: "session_id", value: String(Date.now()) },
        { key: "answers_json", value: JSON.stringify(userData.answers || []) },
        { key: "score_build", value: Math.round(scores.BUILD).toString() },
        { key: "score_sustain", value: Math.round(scores.SUSTAIN).toString() },
        { key: "score_replenish", value: Math.round(scores.REPLENISH).toString() },
        { key: "score_restore", value: Math.round(scores.RESTORE).toString() },
        { key: "result_profile", value: profileId },
        { key: "completed_at", value: new Date().toISOString() }
      ]
    }
  };

  const result = await shopifyQuery(mutation, variables);
  if (result.data?.metaobjectCreate?.userErrors?.length > 0) {
    console.error("❌ SHOPIFY SAVE ERROR:", JSON.stringify(result.data.metaobjectCreate.userErrors, null, 2));
  } else {
    console.log("✅ SUCCESS: Quiz attempt saved to Shopify.");
  }
}

// --- FETCH MATCHING PROFILE ---
async function getResultProfile(primary, secondary) {
  const query = `{
    metaobjects(type: "quiz_result_profile", first: 10) {
      edges {
        node {
          id
          fields {
            key
            value
            references(first: 3) {
              edges {
                node {
                  ... on Product {
                    handle
                    title
                    descriptionHtml
                    featuredImage { url }
                    priceRange { minVariantPrice { amount } }
                    variants(first: 1) { edges { node { id } } }
                    f_label: metafield(namespace: "custom", key: "flavor_label") { value }
                    f_list: metafield(namespace: "custom", key: "flavor_list") { 
                      references(first: 3) {
                        edges {
                          node {
                            ... on Product {
                              handle
                              title
                              featuredImage { url }
                              priceRange { minVariantPrice { amount } }
                              variants(first: 1) { edges { node { id } } }
                              f_label: metafield(namespace: "custom", key: "flavor_label") { value }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

  const data = await shopifyQuery(query);
  if (!data.data || !data.data.metaobjects) return null;

  const profiles = data.data.metaobjects.edges.map(e => {
    let obj = { id: e.node.id };
    e.node.fields.forEach(f => {
      if (f.key === "primary_products" && f.references) {
        obj[f.key] = f.references.edges.map(edge => {
          const p = edge.node;
          return {
            handle: p.handle,
            title: p.title,
            description: p.descriptionHtml,
            image: p.featuredImage?.url,
            price: parseFloat(p.priceRange.minVariantPrice.amount), 
            variantId: p.variants.edges[0]?.node.id.split('/').pop(),
            flavor_label: p.f_label?.value || "Original",
            flavors: p.f_list?.references?.edges.map(fe => ({
              handle: fe.node.handle,
              title: fe.node.title,
              image: fe.node.featuredImage?.url,
              price: parseFloat(fe.node.priceRange.minVariantPrice.amount),
              variantId: fe.node.variants.edges[0]?.node.id.split('/').pop(),
              flavor_label: fe.node.f_label?.value || fe.node.title
            })) || []
          };
        });
      } else {
        obj[f.key] = f.value;
      }
    });
    return obj;
  });

  return profiles.find(p => p.primary_score === primary && (p.secondary_score === secondary || secondary === "NONE"));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { answers, name, email } = req.body;
  try {
    const scores = { BUILD: 0, SUSTAIN: 0, REPLENISH: 0, RESTORE: 0 };
    (answers || []).forEach(a => {
      scores.BUILD += parseFloat(a.score_build || 0);
      scores.SUSTAIN += parseFloat(a.score_sustain || 0);
      scores.REPLENISH += parseFloat(a.score_replenish || 0);
      scores.RESTORE += parseFloat(a.score_restore || 0);
    });

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const profile = await getResultProfile(sorted[0][0], sorted[1][0]);

    if (profile && profile.id) {
      // Save data asynchronously
      saveQuizAttempt(sorted[0][0], sorted[1][0], scores, profile.id, { name, email, answers });
    }

    res.json({ result: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
