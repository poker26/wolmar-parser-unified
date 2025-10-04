using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using AngleSharp;
using AngleSharp.Html.Dom;
using System.Collections.Generic;
using System.Linq;

namespace MeshokParser
{
    public class BrowserProxy
    {
        private readonly HttpClient _httpClient;
        private readonly IBrowsingContext _browsingContext;
        private readonly string _chromeExtensionUrl;

        public BrowserProxy()
        {
            _httpClient = new HttpClient();
            _browsingContext = BrowsingContext.New(Configuration.Default);
            _chromeExtensionUrl = "http://localhost:9222"; // Chrome DevTools Protocol
        }

        public async Task<string> ProcessRequest(string url, Dictionary<string, string>? headers = null)
        {
            try
            {
                // Создаем запрос к Chrome через DevTools Protocol
                var request = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url,
                        waitUntil = "networkidle2"
                    }
                };

                var json = JsonSerializer.Serialize(request);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                // Отправляем запрос в Chrome
                var response = await _httpClient.PostAsync($"{_chromeExtensionUrl}/json/runtime/evaluate", content);
                var responseContent = await response.Content.ReadAsStringAsync();

                // Получаем результат
                var result = JsonSerializer.Deserialize<dynamic>(responseContent);
                
                return await ExtractPageData(url);
            }
            catch (Exception ex)
            {
                return $"Error: {ex.Message}";
            }
        }

        private async Task<string> ExtractPageData(string url)
        {
            try
            {
                // Получаем HTML через Chrome DevTools
                var htmlRequest = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var json = JsonSerializer.Serialize(htmlRequest);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _httpClient.PostAsync($"{_chromeExtensionUrl}/json/runtime/evaluate", content);
                var responseContent = await response.Content.ReadAsStringAsync();

                var result = JsonSerializer.Deserialize<dynamic>(responseContent);
                var html = result?.result?.value?.ToString() ?? "";

                // Парсим HTML с помощью AngleSharp
                var document = await _browsingContext.OpenAsync(req => req.Content(html));

                // Извлекаем данные
                var data = new
                {
                    title = document.Title,
                    url = url,
                    timestamp = DateTime.UtcNow,
                    items = ExtractItems(document),
                    prices = ExtractPrices(document),
                    tables = ExtractTables(document),
                    forms = ExtractForms(document),
                    jsonData = ExtractJsonData(document)
                };

                return JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
            }
            catch (Exception ex)
            {
                return $"Error extracting data: {ex.Message}";
            }
        }

        private List<object> ExtractItems(IDocument document)
        {
            var items = new List<object>();
            var itemLinks = document.QuerySelectorAll("a[href*=\"/item/\"]");

            foreach (var link in itemLinks)
            {
                items.Add(new
                {
                    href = link.GetAttribute("href"),
                    text = link.TextContent.Trim(),
                    title = link.GetAttribute("title") ?? ""
                });
            }

            return items;
        }

        private List<string> ExtractPrices(IDocument document)
        {
            var prices = new List<string>();
            var text = document.Body?.TextContent ?? "";
            var priceRegex = new System.Text.RegularExpressions.Regex(@"[0-9,]+[ ]*₽|[0-9,]+[ ]*руб");
            var matches = priceRegex.Matches(text);

            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                prices.Add(match.Value);
            }

            return prices;
        }

        private List<object> ExtractTables(IDocument document)
        {
            var tables = new List<object>();
            var tableElements = document.QuerySelectorAll("table");

            for (int i = 0; i < tableElements.Length; i++)
            {
                var table = tableElements[i];
                tables.Add(new
                {
                    index = i,
                    rows = table.QuerySelectorAll("tr").Length,
                    cells = table.QuerySelectorAll("td, th").Length
                });
            }

            return tables;
        }

        private List<object> ExtractForms(IDocument document)
        {
            var forms = new List<object>();
            var formElements = document.QuerySelectorAll("form");

            for (int i = 0; i < formElements.Length; i++)
            {
                var form = formElements[i];
                forms.Add(new
                {
                    index = i,
                    action = form.GetAttribute("action") ?? "",
                    method = form.GetAttribute("method") ?? "get",
                    inputs = form.QuerySelectorAll("input").Length
                });
            }

            return forms;
        }

        private List<string> ExtractJsonData(IDocument document)
        {
            var jsonData = new List<string>();
            var scripts = document.QuerySelectorAll("script");

            foreach (var script in scripts)
            {
                var content = script.TextContent;
                var jsonMatches = System.Text.RegularExpressions.Regex.Matches(content, @"\{[^{}]*""[^""]*""[^{}]*\}");
                
                foreach (System.Text.RegularExpressions.Match match in jsonMatches)
                {
                    jsonData.Add(match.Value);
                }
            }

            return jsonData;
        }
    }
}
