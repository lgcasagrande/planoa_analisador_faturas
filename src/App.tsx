import React, { useState, useRef } from 'react';
import { UploadCloud, FileJson, FileText, Loader2, AlertCircle, Plus, Trash2, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import Markdown from 'react-markdown';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Budget {
  category: string;
  limit: number;
  icon?: string;
  color?: string;
}

interface Transaction {
  description: string;
  amount: number;
  category: string;
}

const FALLBACK_BUDGETS: Budget[] = [
  { category: 'Moradia', limit: 1, icon: '🏠', color: 'bg-emerald-500' },
  { category: 'Alimentação (Mercado + Delivery)', limit: 1500, icon: '🍽️', color: 'bg-teal-500' },
  { category: 'Transporte', limit: 700, icon: '🚗', color: 'bg-cyan-500' },
  { category: 'Saúde', limit: 500, icon: '💊', color: 'bg-green-500' },
  { category: 'Lazer (Inclui saídas à restaurantes)', limit: 1000, icon: '🎬', color: 'bg-lime-500' },
  { category: 'Educação', limit: 1600, icon: '📚', color: 'bg-emerald-600' },
];

const COLORS = ['bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-green-500', 'bg-lime-500', 'bg-emerald-600', 'bg-teal-600'];
const ICONS = ['🏠', '🍽️', '🚗', '💊', '🎬', '📚', '🛍️', '💡', '📱', '🛒'];

function getRandomColor(index: number) {
  return COLORS[index % COLORS.length];
}

function getRandomIcon(index: number) {
  return ICONS[index % ICONS.length];
}

export default function App() {
  const [budgets, setBudgets] = useState<Budget[]>(FALLBACK_BUDGETS);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analysis, setAnalysis] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasProcessed, setHasProcessed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPdfFile(e.target.files[0]);
    }
  };

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setJsonFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          if (json.budgets && Array.isArray(json.budgets)) {
            const parsedBudgets = json.budgets.map((b: any, i: number) => ({
              category: b.categoria || b.category || b.name || 'Desconhecido',
              limit: Number(b.maximo || b.limit || b.amount || 0),
              icon: b.icon || getRandomIcon(i),
              color: b.color || getRandomColor(i),
            }));
            setBudgets(parsedBudgets);
          }
        } catch (error) {
          console.error("Erro ao fazer parse do JSON", error);
          alert("Erro ao ler o arquivo JSON. Verifique o formato.");
        }
      };
      reader.readAsText(file);
    }
  };

  const handleBudgetChange = (index: number, field: keyof Budget, value: string | number) => {
    const newBudgets = [...budgets];
    newBudgets[index] = { ...newBudgets[index], [field]: value };
    setBudgets(newBudgets);
  };

  const addBudget = () => {
    setBudgets([...budgets, { category: 'Nova Categoria', limit: 0, icon: getRandomIcon(budgets.length), color: getRandomColor(budgets.length) }]);
  };

  const removeBudget = (index: number) => {
    setBudgets(budgets.filter((_, i) => i !== index));
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const processInvoice = async () => {
    if (!pdfFile) {
      alert("Por favor, faça o upload de uma fatura em PDF.");
      return;
    }

    setIsProcessing(true);
    setStatusMessage('Lendo o documento PDF...');

    try {
      const base64Pdf = await fileToBase64(pdfFile);
      
      setStatusMessage('Analisando a fatura com IA (isso pode levar alguns segundos)...');

      const prompt = `
Você é o Plano A, Analisador de Faturas, um especialista em finanças pessoais.
Sua missão é analisar os itens de uma fatura de cartão de crédito e alocá-los nas categorias de orçamento (budgets) fornecidas, interpretando o contexto e o significado de cada categoria.

Categorias (Budgets) disponíveis:
${budgets.map(b => `- "${b.category}" (Limite: R$ ${b.limit})`).join('\n')}
- "Sem Categoria" (Use apenas se for impossível deduzir)

Instruções:
1. Analise o documento PDF em anexo (que pode ser texto ou imagem escaneada).
2. Extraia cada transação (descrição e valor). Ignore pagamentos da fatura anterior, juros, ou textos irrelevantes.
3. Interprete o significado e o contexto de cada categoria fornecida. Por exemplo, se o usuário criou uma categoria "Lazer (Inclui saídas à restaurantes)", você deve deduzir inteligentemente que bares, cafés, cervejarias, fast food e cinemas pertencem a ela. Se houver "Alimentação (Mercado)", entenda que padarias, açougues e hortifruti entram aí. Use seu conhecimento de mundo para fazer essas associações.
4. Aloque cada transação na categoria que melhor corresponda ao seu contexto.
5. IMPORTANTE PARA O SISTEMA: No JSON de resposta, o campo "category" deve conter exatamente a string da categoria escolhida da lista acima, para que o aplicativo consiga agrupar os itens corretamente na interface.
6. Se o nome do estabelecimento for ambíguo (ex: "PAY-P-SAO-PAULO", "EBANX", "PAG*"), use seu conhecimento para identificar a natureza do gasto.
7. Calcule o total gasto em cada categoria para basear sua análise.
8. Escreva uma "Análise de Hábitos" detalhada. Em vez de um texto único, crie uma lista de marcadores (bullet points) PARA CADA categoria que teve gastos.
   - Use o formato de lista do Markdown (iniciando com "- ").
   - Formate cada item começando com o nome da categoria em negrito (ex: "- **Alimentação:** Você gastou...").
   - Adicione uma quebra de linha dupla (duas vezes Enter) entre cada item da lista para garantir espaçamento visual.
   - Destaque se o limite foi excedido e dê sugestões práticas de economia baseadas nos itens específicos encontrados.
9. Tom de voz para a análise: Seja um peer prestativo, autêntico e levemente sagaz. Use português brasileiro (PT-BR). Seja direto na correção de desvios financeiros, mas empático com gastos essenciais.

Retorne um JSON estrito com o seguinte formato:
{
  "transactions": [
    { "description": "Nome do estabelecimento", "amount": 150.50, "category": "String exata da categoria escolhida" }
  ],
  "analysis": "Texto da análise de hábitos..."
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    category: { type: Type.STRING }
                  },
                  required: ["description", "amount", "category"]
                }
              },
              analysis: { type: Type.STRING }
            },
            required: ["transactions", "analysis"]
          }
        }
      });

      const resultText = response.text;
      if (resultText) {
        const result = JSON.parse(resultText);
        setTransactions(result.transactions || []);
        setAnalysis(result.analysis || '');
        setHasProcessed(true);
      }

    } catch (error) {
      console.error("Erro ao processar fatura:", error);
      alert("Ocorreu um erro ao processar a fatura. Tente novamente.");
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  const calculateCategoryTotals = () => {
    const totals: Record<string, number> = {};
    transactions.forEach(t => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    return totals;
  };

  const categoryTotals = calculateCategoryTotals();

  const totalBudget = budgets.reduce((acc, b) => acc + b.limit, 0);
  const totalSpent = transactions.reduce((acc, t) => acc + t.amount, 0);
  const totalPercentage = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const isTotalOverBudget = totalSpent > totalBudget;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans p-4 sm:p-6 md:p-12 overflow-x-hidden">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
          <img 
            src="/logo_square_full.png" 
            alt="Plano A Logo" 
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover shadow-lg shadow-emerald-500/20 border border-emerald-500/20 shrink-0"
          />
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold flex flex-wrap items-baseline gap-x-2">
              <span className="text-emerald-400">Plano A</span>
              <span className="text-white">Analisador de Faturas</span>
            </h1>
            <p className="text-slate-400 text-sm sm:text-base">Faça o upload da sua fatura e descubra para onde seu dinheiro está indo.</p>
          </div>
        </header>

        {!hasProcessed ? (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Upload PDF */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-4 transition-colors hover:bg-slate-800">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center">
                  <FileText size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white">Fatura do Cartão (PDF)</h3>
                  <p className="text-sm text-slate-400 mt-1">Obrigatório para análise</p>
                </div>
                <label className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-full font-medium transition-colors">
                  Selecionar PDF
                  <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfUpload} />
                </label>
                {pdfFile && <p className="text-sm text-emerald-400 font-medium break-all">{pdfFile.name}</p>}
              </div>

              {/* Upload JSON */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center space-y-4 transition-colors hover:bg-slate-800">
                <div className="w-16 h-16 bg-teal-500/20 text-teal-400 rounded-full flex items-center justify-center">
                  <FileJson size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white">Estrutura de Budgets (JSON)</h3>
                  <p className="text-sm text-slate-400 mt-1">Opcional. Preenche a lista abaixo.</p>
                </div>
                <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-full font-medium transition-colors">
                  Selecionar JSON
                  <input type="file" accept="application/json" className="hidden" onChange={handleJsonUpload} />
                </label>
                {jsonFile && <p className="text-sm text-teal-400 font-medium break-all">{jsonFile.name}</p>}
              </div>

              {/* Editable Budgets List */}
              <div className="md:col-span-2 bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 sm:p-6 mt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <h3 className="text-lg font-medium text-white">Categorias e Orçamentos</h3>
                  <button onClick={addBudget} className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors self-start sm:self-auto">
                    <Plus size={16} /> Nova Categoria
                  </button>
                </div>
                <div className="space-y-3">
                  {budgets.map((budget, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-slate-800/40 sm:bg-transparent p-3 sm:p-0 rounded-xl sm:rounded-none border border-slate-700/50 sm:border-none">
                      <div className="flex items-center gap-3 w-full sm:w-auto flex-1">
                        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-lg shrink-0">
                          {budget.icon}
                        </div>
                        <input
                          type="text"
                          value={budget.category}
                          onChange={(e) => handleBudgetChange(idx, 'category', e.target.value)}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors min-w-0"
                          placeholder="Nome da categoria"
                        />
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto pl-13 sm:pl-0">
                        <div className="relative flex-1 sm:w-32 shrink-0">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">R$</span>
                          <input
                            type="number"
                            value={budget.limit}
                            onChange={(e) => handleBudgetChange(idx, 'limit', Number(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                            placeholder="0.00"
                          />
                        </div>
                        <button onClick={() => removeBudget(idx)} className="text-slate-500 hover:text-red-400 p-2 transition-colors shrink-0">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 flex flex-col items-center mt-4">
                <button 
                  onClick={processInvoice}
                  disabled={!pdfFile || isProcessing}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-full font-bold text-lg shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin" /> Processando...
                    </>
                  ) : (
                    'Analisar Fatura'
                  )}
                </button>
                {statusMessage && (
                  <p className="text-emerald-400 mt-4 flex items-center gap-2 animate-pulse text-sm sm:text-base text-center">
                    <AlertCircle size={18} className="shrink-0" /> {statusMessage}
                  </p>
                )}
              </div>
            </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Dashboard */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Resumo do Mês</h2>
                <div className="mt-2 flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-slate-400">Total Gasto:</span>
                  <span className={`font-mono font-bold ${isTotalOverBudget ? 'text-red-400' : 'text-white'}`}>
                    R$ {totalSpent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-slate-500">/</span>
                  <span className="font-mono text-slate-400">
                    R$ {totalBudget.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isTotalOverBudget ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {totalPercentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              <button 
                onClick={() => { setTransactions([]); setAnalysis(''); setPdfFile(null); setHasProcessed(false); setExpandedCategories(new Set()); }}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-slate-700 shrink-0"
              >
                <ArrowLeft size={16} /> Nova Análise
              </button>
            </div>

            {transactions.length === 0 ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 text-center">
                <p className="text-slate-400">Nenhuma transação foi encontrada no PDF. Verifique se o arquivo contém texto extraível.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {budgets.map((budget, idx) => {
                const spent = categoryTotals[budget.category] || 0;
                const percentage = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
                const barPercentage = Math.min(percentage, 100);
                const isOverBudget = spent > budget.limit;
                const isExpanded = expandedCategories.has(budget.category);
                const categoryTransactions = transactions.filter(t => t.category === budget.category);

                return (
                  <div key={idx} className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-2 transition-colors hover:border-slate-600">
                    <div 
                      className="flex justify-between items-center cursor-pointer group"
                      onClick={() => toggleCategory(budget.category)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{budget.icon}</span>
                        <span className="font-medium text-slate-200 text-sm group-hover:text-white transition-colors">{budget.category}</span>
                        <ChevronDown size={16} className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <div className="font-mono text-sm text-white flex items-baseline gap-1">
                          <span className={isOverBudget ? 'text-red-400' : ''}>R$ {spent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="text-slate-500 text-xs font-sans">/ R$ {budget.limit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className={`text-[10px] font-medium ${isOverBudget ? 'text-red-400' : 'text-slate-500'}`}>
                          {percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    
                    <div className="relative h-1.5 w-full bg-slate-900 rounded-full overflow-hidden mt-1">
                      <div 
                        className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ${isOverBudget ? 'bg-red-500' : budget.color || 'bg-emerald-500'}`}
                        style={{ width: `${barPercentage}%` }}
                      />
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2 animate-in slide-in-from-top-2 duration-200">
                        {categoryTransactions.length > 0 ? (
                          categoryTransactions.map((t, i) => (
                            <div key={i} className="flex justify-between items-center text-sm">
                              <span className="text-slate-400 truncate pr-4">{t.description}</span>
                              <span className="text-slate-300 font-mono shrink-0">R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-slate-500 italic">Nenhuma transação nesta categoria.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {/* Sem Categoria */}
              {(categoryTotals['Sem Categoria'] || 0) > 0 && (() => {
                const isExpanded = expandedCategories.has('Sem Categoria');
                const semCategoriaTransactions = transactions.filter(t => t.category === 'Sem Categoria' || !budgets.some(b => b.category === t.category));
                
                return (
                  <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-2 opacity-75 transition-colors hover:border-slate-600">
                    <div 
                      className="flex justify-between items-center cursor-pointer group"
                      onClick={() => toggleCategory('Sem Categoria')}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">❓</span>
                        <span className="font-medium text-slate-200 text-sm group-hover:text-white transition-colors">Sem Categoria</span>
                        <ChevronDown size={16} className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <div className="font-mono text-sm text-white">
                          R$ {(categoryTotals['Sem Categoria']).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2 animate-in slide-in-from-top-2 duration-200">
                        {semCategoriaTransactions.length > 0 ? (
                          semCategoriaTransactions.map((t, i) => (
                            <div key={i} className="flex justify-between items-center text-sm">
                              <span className="text-slate-400 truncate pr-4">{t.description}</span>
                              <span className="text-slate-300 font-mono shrink-0">R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-slate-500 italic">Nenhuma transação nesta categoria.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            )}

            {/* Análise de Hábitos */}
            <div className="bg-gradient-to-br from-emerald-900/30 to-teal-900/30 border border-emerald-500/20 rounded-3xl p-6 sm:p-8 mt-8">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">💡</span> Análise de Hábitos
              </h3>
              <div className="markdown-body text-slate-300 leading-relaxed text-sm sm:text-base">
                <Markdown>{analysis}</Markdown>
              </div>
            </div>
            
            {/* Lista de Transações (Opcional/Debug) */}
            <details className="mt-8">
              <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-300 transition-colors">
                Ver todas as transações extraídas
              </summary>
              <div className="mt-4 bg-slate-800/50 rounded-xl p-4 max-h-96 overflow-y-auto overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[400px]">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      <th className="pb-2 font-medium">Descrição</th>
                      <th className="pb-2 font-medium">Categoria</th>
                      <th className="pb-2 font-medium text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t, i) => (
                      <tr key={i} className="border-b border-slate-700/50 last:border-0">
                        <td className="py-2 text-slate-300">{t.description}</td>
                        <td className="py-2 text-slate-400">{t.category}</td>
                        <td className="py-2 text-slate-300 text-right font-mono">
                          R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

          </div>
        )}
      </div>
    </div>
  );
}
