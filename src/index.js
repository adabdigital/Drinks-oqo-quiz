// Cloudflare Workers version of OQO Quiz Backend
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check endpoint
    if (path === '/' && request.method === 'GET') {
      return new Response('OQO Quiz Engine Online 🚀', {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Submit quiz endpoint
    if (path === '/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { answers } = body;

        if (!answers || !Array.isArray(answers)) {
          return Response.json({ error: 'Invalid data format' }, {
            status: 400,
            headers: corsHeaders,
          });
        }

        // Calculate scores
        const scores = calculateScores(answers);
        console.log(`📊 Scores: BUILD:${scores.BUILD}, SUSTAIN:${scores.SUSTAIN}, REPLENISH:${scores.REPLENISH}, RESTORE:${scores.RESTORE}`);

        // Get result type
        const { primary, secondary } = getResultType(scores);
        console.log(`🎯 Determined Target: ${primary} + ${secondary}`);

        // Fetch profile from Shopify
        const profile = await getResultProfile(primary, secondary, env);

        if (!profile) {
          console.warn(`❌ No Profile found for ${primary}/${secondary}`);
          return Response.json({ error: 'Profile not found' }, {
            status: 404,
            headers: corsHeaders,
          });
        }

        console.log(`✅ Matched Profile: ${profile.id}`);

        // Save attempt (fire and forget)
        ctx.waitUntil(saveAttempt({ answers, scores, result_id: profile.id }, env));

        return Response.json({
          scores,
          primary,
          secondary,
          result: profile,
        }, {
          headers: corsHeaders,
        });

      } catch (error) {
        console.error('🔥 Server Error:', error.message);
        return Response.json({ error: error.message }, {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // 404 for other routes
    return Response.json({ error: 'Not Found' }, {
      status: 404,
      headers: corsHeaders,
    });
  },
};

// Helper functions
function calculateScores(answers) {
  let scores = { BUILD: 0, SUSTAIN: 0, REPLENISH: 0, RESTORE: 0 };
  
  answers.forEach((a) => {
    scores.BUILD += parseFloat(a.score_build || 0);
    scores.SUSTAIN += parseFloat(a.score_sustain || 0);
    scores.REPLENISH += parseFloat(a.score_replenish || 0);
    scores.RESTORE += parseFloat(a.score_restore || 0);
  });
  
  return scores;
}

function getResultType(scores) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0];
  const secondary = sorted[1][0];

  if (primary === "BUILD" && secondary === "SUSTAIN") return { primary, secondary };
  if (primary === "SUSTAIN" && secondary === "REPLENISH") return { primary, secondary };
  if (primary === "BUILD" && secondary === "RESTORE") return { primary, secondary };
  if (primary === "REPLENISH" && secondary === "BUILD") return { primary, secondary };
  if (primary === "SUSTAIN") return { primary: "SUSTAIN", secondary: "NONE" };

  return { primary: "BALANCED", secondary: "BALANCED" };
}

async function getResultProfile(primary, secondary, env) {
  const query = `{
    metaobjects(type: "quiz_result_profile", first: 50) {
      edges {
        node {
          id
          fields { key value }
        }
      }
    }
  }`;

  const response = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/${env.API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  
  if (!response.ok || data.errors) {
    console.error('❌ Shopify API Error:', JSON.stringify(data.errors || data, null, 2));
    throw new Error('Shopify request failed');
  }

  const profiles = data.data.metaobjects.edges.map(e => {
    let obj = { id: e.node.id };
    e.node.fields.forEach(f => {
      try {
        obj[f.key] = (f.value && f.value.startsWith('[')) ? JSON.parse(f.value) : f.value;
      } catch { 
        obj[f.key] = f.value; 
      }
    });
    return obj;
  });

  return profiles.find((p) => {
    const pScore = (p.primary_score || "").toString().trim().toUpperCase();
    const sScore = (p.secondary_score || "").toString().trim().toUpperCase();
    
    return pScore === primary.toUpperCase() && 
           (sScore === secondary.toUpperCase() || (secondary.toUpperCase() === "NONE" && (!sScore || sScore === "NONE" || sScore === "")));
  });
}

async function saveAttempt(payload, env) {
  try {
    const safeAnswers = JSON.stringify(payload.answers).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const mutation = `mutation {
      metaobjectCreate(metaobject: {
        type: "quiz_attempt",
        fields: [
          { key: "attempt_id", value: "oqo_${Date.now()}" },
          { key: "answers_json", value: "${safeAnswers}" },
          { key: "score_build", value: "${Math.round(payload.scores.BUILD)}" },
          { key: "score_sustain", value: "${Math.round(payload.scores.SUSTAIN)}" },
          { key: "score_replenish", value: "${Math.round(payload.scores.REPLENISH)}" },
          { key: "score_restore", value: "${Math.round(payload.scores.RESTORE)}" },
          { key: "result_profile", value: "${payload.result_id}" },
          { key: "completed_at", value: "${new Date().toISOString()}" }
        ]
      }) { metaobject { id } userErrors { field message } }
    }`;

    await fetch(`https://${env.SHOPIFY_STORE}/admin/api/${env.API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query: mutation }),
    });
  } catch (err) { 
    console.error('⚠ Metaobject Save failed:', err.message); 
  }
}
