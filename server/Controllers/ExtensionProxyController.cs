using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ExtensionProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public ExtensionProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Получаем список вкладок Chrome
                var tabsResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json");
                var tabsJson = await tabsResponse.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<JsonElement[]>(tabsJson);

                if (tabs == null || tabs.Length == 0)
                {
                    return StatusCode(500, "No Chrome tabs available");
                }

                // Используем первую вкладку
                var tab = tabs[0];
                var tabId = tab.GetProperty("id").GetString();
                var webSocketUrl = tab.GetProperty("webSocketDebuggerUrl").GetString();

                if (string.IsNullOrEmpty(webSocketUrl))
                {
                    return StatusCode(500, "No WebSocket URL available");
                }

                // Навигируем к URL через Chrome DevTools
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url
                    }
                };

                var navigateJson = JsonSerializer.Serialize(navigateCommand);
                var navigateContent = new StringContent(navigateJson, Encoding.UTF8, "application/json");

                // Отправляем команду навигации
                var navigateResponse = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/runtime/evaluate", navigateContent);
                
                // Ждем загрузки страницы
                await Task.Delay(5000);

                // Получаем HTML содержимое
                var htmlCommand = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var htmlJson = JsonSerializer.Serialize(htmlCommand);
                var htmlContent = new StringContent(htmlJson, Encoding.UTF8, "application/json");

                var htmlResponse = await _httpClient.PostAsync($"{_chromeDebugUrl}/json/runtime/evaluate", htmlContent);
                
                if (!htmlResponse.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to get page content: {htmlResponse.StatusCode}");
                }

                var htmlResult = await htmlResponse.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<JsonElement>(htmlResult);
                
                var html = "";
                if (result.TryGetProperty("result", out var resultElement) && 
                    resultElement.TryGetProperty("value", out var valueElement))
                {
                    html = valueElement.GetString() ?? "";
                }

                // Проверяем на Cloudflare
                if (html.Contains("Just a moment") || html.Contains("Один момент") || html.Contains("Cloudflare"))
                {
                    return Ok(new
                    {
                        success = false,
                        message = "Cloudflare challenge detected",
                        html = html.Substring(0, Math.Min(1000, html.Length)),
                        timestamp = System.DateTime.UtcNow,
                        method = "chrome_extension"
                    });
                }

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = html,
                    timestamp = System.DateTime.UtcNow,
                    method = "chrome_extension"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
