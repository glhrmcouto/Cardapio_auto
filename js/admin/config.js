import { supabase } from '../supabaseClient.js';

const configCarregandoEl = document.getElementById('configCarregando');
const configErroEl = document.getElementById('configErro');
const configTentarBtn = document.getElementById('configTentar');
const configForm = document.getElementById('configForm');
const taxaServicoInputEl = document.getElementById('taxaServicoInput');
const configFeedbackEl = document.getElementById('configFeedback');

// ========================================
// CONFIGURAÇÕES (taxa de serviço — ver supabase/010_taxa_servico_configuravel.sql)
// ========================================
//
// "configuracoes" é uma tabela chave/valor (texto puro) editável só por admin
// (RLS eh_admin(), mesmo padrão de produtos). O percentual da taxa é lido
// direto daqui pelas RPCs de pedido/fechamento — mudar aqui já vale pro
// próximo pedido, sem precisar de deploy. Zerar o percentual desativa a
// taxa por completo (fechar_parcial/conta_da_mesa passam a cobrar R$ 0,00).

export async function carregarConfiguracoes() {
  configCarregandoEl.style.display = 'block';
  configErroEl.style.display = 'none';
  configForm.style.display = 'none';

  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('valor')
      .eq('chave', 'taxa_servico_percentual')
      .maybeSingle();

    if (error) throw error;

    taxaServicoInputEl.value = data ? data.valor : '10';
    configCarregandoEl.style.display = 'none';
    configForm.style.display = 'flex';
  } catch (erro) {
    console.error('Erro ao carregar configurações:', erro);
    configCarregandoEl.style.display = 'none';
    configErroEl.style.display = 'block';
  }
}

configTentarBtn.addEventListener('click', carregarConfiguracoes);

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const percentual = parseFloat(taxaServicoInputEl.value);
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    configFeedbackEl.textContent = 'Percentual inválido (deve ser entre 0 e 100).';
    configFeedbackEl.className = 'admin-produto-card__feedback admin-produto-card__feedback--erro';
    return;
  }

  const botaoSalvar = configForm.querySelector('button[type="submit"]');
  botaoSalvar.disabled = true;
  botaoSalvar.textContent = 'Salvando...';

  const { error } = await supabase
    .from('configuracoes')
    .update({ valor: String(percentual) })
    .eq('chave', 'taxa_servico_percentual');

  botaoSalvar.disabled = false;
  botaoSalvar.textContent = 'Salvar';

  if (error) {
    console.error('Erro ao salvar taxa de serviço:', error);
    configFeedbackEl.textContent = 'Não foi possível salvar agora. Verifique sua conexão e tente de novo.';
    configFeedbackEl.className = 'admin-produto-card__feedback admin-produto-card__feedback--erro';
    return;
  }

  configFeedbackEl.textContent = percentual === 0
    ? 'Salvo! Taxa de serviço desativada.'
    : 'Salvo com sucesso!';
  configFeedbackEl.className = 'admin-produto-card__feedback admin-produto-card__feedback--sucesso';
});
